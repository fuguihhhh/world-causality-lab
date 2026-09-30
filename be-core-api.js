/*
 * Border Epoch — Unified Core API
 * File: be-core-api.js
 * Kernel / registry / router / event bus / annual tick coordinator / diagnostics
 *
 * Design contract:
 *   Modules own rules and their state.
 *   Core owns connection, routing, validation, isolation and observability.
 *
 *   Query   = read
 *   Command = request state change from the owning module
 *   Event   = notification only
 *   Tick    = the single annual-time coordinator
 *
 * This file intentionally does NOT calculate GDP, crop yield, rail capacity,
 * prices, population, diplomacy, AI strategy, research outcomes or reserves.
 */
(function (global) {
  'use strict';

  /* ========================================================================
     1. Constants
     ======================================================================== */

  var BorderEpoch = global.BorderEpoch = global.BorderEpoch || {};

  var CORE_VERSION = '1.0.0';
  var API_VERSION = '1.0.0';
  var MAX_EVENT_DEPTH = 16;
  var MAX_DEBUG_RECORDS = 500;
  var MAX_EVENT_HISTORY = 500;

  var MODULE_IDS = Object.freeze({
    M1: 'World',
    M2: 'Development',
    M3: 'Economy',
    M4: 'Population',
    M5: 'Trade',
    M6: 'AI',
    M7: 'Events',
    M8: 'Integration',
    M9: 'Agriculture',
    M10: 'Research'
  });

  var MODULE_ORDER = Object.freeze([
    'World', 'Development', 'Economy', 'Population', 'Trade',
    'AI', 'Events', 'Integration', 'Agriculture', 'Research'
  ]);

  var ERROR_CODES = Object.freeze({
    MODULE_NOT_REGISTERED: 'MODULE_NOT_REGISTERED',
    API_NOT_AVAILABLE: 'API_NOT_AVAILABLE',
    INVALID_ARGUMENT: 'INVALID_ARGUMENT',
    INVALID_STATE: 'INVALID_STATE',
    STATE_NOT_OWNED: 'STATE_NOT_OWNED',
    DEPENDENCY_MISSING: 'DEPENDENCY_MISSING',
    COMMAND_REJECTED: 'COMMAND_REJECTED',
    INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
    RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE',
    ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
    DUPLICATE_TICK: 'DUPLICATE_TICK',
    ANNUAL_TICK_ALREADY_RUNNING: 'ANNUAL_TICK_ALREADY_RUNNING',
    VERSION_MISMATCH: 'VERSION_MISMATCH',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    DUPLICATE_MODULE_ID: 'DUPLICATE_MODULE_ID',
    DUPLICATE_SERVICE: 'DUPLICATE_SERVICE',
    DUPLICATE_HOOK: 'DUPLICATE_HOOK',
    NOT_INITIALIZED: 'NOT_INITIALIZED'
  });

  var DEFAULT_OWNERSHIP = Object.freeze({
    World: ['world', 'regions', 'cities', 'resourceEndowments'],
    Development: ['development', 'projects', 'transport', 'connections', 'facilities', 'explorationResults', 'discoveredDeposits'],
    Economy: ['economy', 'treasury', 'inventory'],
    Population: ['population'],
    Trade: ['trade', 'tradeContracts', 'tradeRoutes', 'tradeRelations', 'diplomaticRelations', 'diplomacy'],
    AI: ['aiCountries'],
    Events: ['events', 'issues'],
    Integration: ['integration'],
    Agriculture: ['agriculture'],
    Research: ['research']
  });

  var DEFAULT_DEPENDENCIES = Object.freeze({
    World: [],
    Development: ['World'],
    Economy: ['World', 'Development'],
    Population: ['World', 'Economy'],
    Trade: ['World', 'Development', 'Economy', 'Population'],
    AI: ['World', 'Development', 'Economy', 'Population', 'Trade'],
    Events: ['Development', 'Economy', 'Population', 'Trade', 'AI'],
    Integration: ['World', 'Development', 'Economy', 'Population', 'Trade', 'AI', 'Events', 'Agriculture'],
    Agriculture: ['World', 'Development', 'Economy'],
    Research: ['World', 'Development', 'Economy']
  });

  var DEFAULT_CAPABILITIES = Object.freeze({
    World: ['world.region', 'world.city', 'world.resourceEndowment', 'world.discoveredResources'],
    Development: ['transport.routing', 'transport.capacity', 'construction.projects', 'resource.development'],
    Economy: ['economy.finance', 'economy.treasury', 'economy.market', 'economy.inventory'],
    Population: ['population.demography', 'population.labor', 'population.housing'],
    Trade: ['trade.contract', 'trade.route', 'trade.quote', 'diplomacy.relationship'],
    AI: ['ai.intent', 'ai.decision', 'ai.status'],
    Events: ['events.active', 'events.history'],
    Integration: ['integration.view', 'integration.navigation', 'integration.ui', 'integration.annualRunner'],
    Agriculture: ['agriculture.production', 'agriculture.storage', 'agriculture.freightDemand', 'agriculture.policy'],
    Research: ['research.capability', 'research.problem', 'research.project', 'research.modifier']
  });

  /* ========================================================================
     2. Utility
     ======================================================================== */

  function nowMs() {
    if (global.performance && typeof global.performance.now === 'function') return global.performance.now();
    return Date.now();
  }

  function isObject(v) { return v !== null && typeof v === 'object'; }
  function isFunction(v) { return typeof v === 'function'; }
  function isString(v) { return typeof v === 'string' && v.length > 0; }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  function safeClone(value) {
    if (value == null) return value;
    if (typeof global.structuredClone === 'function') {
      try { return global.structuredClone(value); } catch (_) { /* fallback below */ }
    }
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return value; }
  }

  function deepFreeze(obj, seen) {
    if (!isObject(obj) || Object.isFrozen(obj)) return obj;
    seen = seen || [];
    if (seen.indexOf(obj) >= 0) return obj;
    seen.push(obj);
    try { Object.freeze(obj); } catch (_) { return obj; }
    Object.keys(obj).forEach(function (k) { deepFreeze(obj[k], seen); });
    return obj;
  }

  function stableStringify(value) {
    var seen = [];
    function normalize(v) {
      if (!isObject(v)) return v;
      if (seen.indexOf(v) >= 0) return '[Circular]';
      seen.push(v);
      var out;
      if (Array.isArray(v)) out = v.map(normalize);
      else {
        out = {};
        Object.keys(v).sort().forEach(function (k) { out[k] = normalize(v[k]); });
      }
      seen.pop();
      return out;
    }
    try { return JSON.stringify(normalize(value)); }
    catch (_) { return String(value); }
  }

  function getPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = Array.isArray(path) ? path : String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i += 1) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, value) {
    if (!obj || !path) return obj;
    var parts = Array.isArray(path) ? path : String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i += 1) {
      if (!isObject(cur[parts[i]])) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  function firstDefined() {
    for (var i = 0; i < arguments.length; i += 1) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    return undefined;
  }

  function firstFunction(obj, names) {
    if (!obj) return null;
    for (var i = 0; i < names.length; i += 1) {
      var fn = getPath(obj, names[i]);
      if (isFunction(fn)) return { fn: fn, path: names[i] };
    }
    return null;
  }

  function objectValues(obj) {
    if (!obj) return [];
    return Object.keys(obj).map(function (k) { return obj[k]; });
  }

  function makeId(prefix) {
    makeId._seq = (makeId._seq || 0) + 1;
    return String(prefix || 'id') + '_' + Date.now().toString(36) + '_' + makeId._seq.toString(36);
  }

  function makeRingBuffer(max) {
    var list = [];
    return {
      push: function (item) {
        list.push(item);
        if (list.length > max) list.splice(0, list.length - max);
      },
      values: function () { return list.slice(); },
      clear: function () { list.length = 0; },
      size: function () { return list.length; },
      max: max
    };
  }

  var debugBuffer = makeRingBuffer(MAX_DEBUG_RECORDS);
  var eventHistory = makeRingBuffer(MAX_EVENT_HISTORY);

  function logDebug(kind, detail) {
    if (!Core.DEBUG) return;
    debugBuffer.push({ at: Date.now(), kind: kind, detail: safeClone(detail) });
  }

  function consoleWarn() {
    if (global.console && isFunction(global.console.warn)) {
      try { global.console.warn.apply(global.console, arguments); } catch (_) { /* ignore */ }
    }
  }

  function consoleError() {
    if (global.console && isFunction(global.console.error)) {
      try { global.console.error.apply(global.console, arguments); } catch (_) { /* ignore */ }
    }
  }

  /* ========================================================================
     3. Result Envelope
     ======================================================================== */

  function ok(data, meta) {
    return { ok: true, data: data === undefined ? null : data, error: null, meta: meta || {} };
  }

  function fail(code, message, moduleId, meta) {
    return {
      ok: false,
      data: null,
      error: {
        code: code || ERROR_CODES.INTERNAL_ERROR,
        message: message || code || 'Unknown error',
        module: moduleId || null
      },
      meta: meta || {}
    };
  }

  function looksLikeEnvelope(v) {
    return isObject(v) && typeof v.ok === 'boolean' && Object.prototype.hasOwnProperty.call(v, 'data') && Object.prototype.hasOwnProperty.call(v, 'error');
  }

  function normalizeResult(value, moduleId, meta) {
    if (looksLikeEnvelope(value)) {
      if (!value.meta) value.meta = meta || {};
      return value;
    }
    /* Common legacy shapes: {ok:false,error:'...'} and {ok:true,...}. */
    if (isObject(value) && value.ok === false) {
      var legacyError = value.error;
      var code = legacyError && legacyError.code ? legacyError.code : ERROR_CODES.COMMAND_REJECTED;
      var message = legacyError && legacyError.message ? legacyError.message : (typeof legacyError === 'string' ? legacyError : 'Legacy command rejected.');
      return fail(code, message, moduleId, meta);
    }
    if (isObject(value) && value.ok === true) {
      return ok(Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value, meta);
    }
    if (value === false) return fail(ERROR_CODES.COMMAND_REJECTED, 'Legacy API returned false.', moduleId, meta);
    return ok(value, meta);
  }

  function fromException(err, moduleId, operation) {
    consoleError('[BorderEpoch Core]', moduleId || 'Core', operation || 'operation', err);
    return fail(
      ERROR_CODES.INTERNAL_ERROR,
      err && err.message ? String(err.message) : String(err),
      moduleId || null,
      { operation: operation || null }
    );
  }

  /* ========================================================================
     4. Semver
     ======================================================================== */

  function parseSemver(v) {
    var s = String(v == null ? '0.0.0' : v).trim();
    var mainAndPre = s.split('+')[0].split('-');
    var nums = mainAndPre[0].split('.').map(function (x) {
      var n = parseInt(x, 10);
      return isFinite(n) ? n : 0;
    });
    while (nums.length < 3) nums.push(0);
    var pre = mainAndPre.length > 1 ? mainAndPre.slice(1).join('-').split('.') : [];
    return { major: nums[0], minor: nums[1], patch: nums[2], pre: pre };
  }

  function compareIdentifiers(a, b) {
    var an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
    if (an && bn) return parseInt(a, 10) === parseInt(b, 10) ? 0 : (parseInt(a, 10) > parseInt(b, 10) ? 1 : -1);
    if (an !== bn) return an ? -1 : 1;
    return a === b ? 0 : (a > b ? 1 : -1);
  }

  function compareSemver(a, b) {
    var A = parseSemver(a), B = parseSemver(b);
    if (A.major !== B.major) return A.major > B.major ? 1 : -1;
    if (A.minor !== B.minor) return A.minor > B.minor ? 1 : -1;
    if (A.patch !== B.patch) return A.patch > B.patch ? 1 : -1;
    if (!A.pre.length && !B.pre.length) return 0;
    if (!A.pre.length) return 1;
    if (!B.pre.length) return -1;
    var len = Math.max(A.pre.length, B.pre.length);
    for (var i = 0; i < len; i += 1) {
      if (A.pre[i] === undefined) return -1;
      if (B.pre[i] === undefined) return 1;
      var c = compareIdentifiers(A.pre[i], B.pre[i]);
      if (c) return c;
    }
    return 0;
  }

  /* ========================================================================
     5. Core Runtime / Module Registry
     ======================================================================== */

  var Core = {
    VERSION: CORE_VERSION,
    API_VERSION: API_VERSION,
    DEBUG: false,
    compatibilityMode: true,
    MODULE_IDS: MODULE_IDS,
    ERROR_CODES: ERROR_CODES,
    modules: {},
    adapters: {},
    ownership: {},
    runtime: {
      initialized: false,
      getGameState: null,
      moduleScanCount: 0,
      missingModules: {},
      failedRegistrations: {},
      dependencies: {},
      capabilityProviders: {},
      services: {},
      deprecations: [],
      migrations: {},
      legacyAdapterUse: {},
      lastSelfCheck: null
    }
  };

  MODULE_ORDER.forEach(function (id) { Core.ownership[id] = (DEFAULT_OWNERSHIP[id] || []).slice(); });

  function getGameState() {
    try {
      if (isFunction(Core.runtime.getGameState)) return Core.runtime.getGameState();
    } catch (e) {
      consoleError('[BorderEpoch Core] getGameState failed', e);
    }
    return global.gameState || null;
  }

  Core.initialize = function (options) {
    options = options || {};
    if (options.getGameState != null && !isFunction(options.getGameState)) {
      return fail(ERROR_CODES.INVALID_ARGUMENT, 'initialize.getGameState must be a function.', 'Core');
    }
    if (options.getGameState) Core.runtime.getGameState = options.getGameState;
    if (typeof options.debug === 'boolean') Core.DEBUG = options.debug;
    if (typeof options.compatibilityMode === 'boolean') Core.compatibilityMode = options.compatibilityMode;
    Core.runtime.initialized = true;
    logDebug('core.initialize', { hasStateProvider: !!Core.runtime.getGameState });
    return ok({ version: Core.VERSION, initialized: true });
  };

  Core.registerModule = function (spec) {
    spec = spec || {};
    var id = spec.id;
    if (!isString(id)) return fail(ERROR_CODES.INVALID_ARGUMENT, 'Module id must be a non-empty canonical string.', id || 'Core');
    if (!spec.api) {
      Core.runtime.failedRegistrations[id] = { registered: false, reason: 'module_not_loaded', at: Date.now() };
      Core.runtime.missingModules[id] = true;
      return fail(ERROR_CODES.MODULE_NOT_REGISTERED, 'Module is not loaded.', id, { reason: 'module_not_loaded' });
    }
    if (Core.modules[id]) {
      if (Core.modules[id].api === spec.api) return ok(Core.modules[id], { alreadyRegistered: true });
      return fail(ERROR_CODES.DUPLICATE_MODULE_ID, 'Module id is already registered: ' + id, id);
    }
    if (spec.requiredCoreVersion && compareSemver(CORE_VERSION, spec.requiredCoreVersion) < 0) {
      return fail(ERROR_CODES.VERSION_MISMATCH, 'Core ' + CORE_VERSION + ' does not satisfy required version ' + spec.requiredCoreVersion + '.', id);
    }

    var entry = {
      id: id,
      registered: true,
      MODULE_VERSION: String(firstDefined(spec.MODULE_VERSION, spec.version, spec.api.MODULE_VERSION, spec.api.VERSION, '0.0.0')),
      API_VERSION: String(firstDefined(spec.API_VERSION, spec.apiVersion, spec.api.API_VERSION, API_VERSION)),
      api: spec.api,
      stateNamespace: spec.stateNamespace || null,
      capabilities: (spec.capabilities || DEFAULT_CAPABILITIES[id] || []).slice(),
      annualHooks: spec.annualHooks || {},
      dependencies: (spec.dependencies || DEFAULT_DEPENDENCIES[id] || []).slice(),
      registeredAt: Date.now()
    };

    Core.modules[id] = entry;
    Core.runtime.dependencies[id] = entry.dependencies.slice();
    if (!Core.ownership[id]) Core.ownership[id] = (spec.ownership || []).slice();
    if (typeof APIs !== 'undefined' && APIs) {
      var apiNs = ensureApiNamespace(id);
      apiNs.MODULE_VERSION = entry.MODULE_VERSION;
      apiNs.API_VERSION = entry.API_VERSION;
      apiNs.VERSION = entry.API_VERSION;
    }
    delete Core.runtime.failedRegistrations[id];
    delete Core.runtime.missingModules[id];

    entry.capabilities.forEach(function (cap) {
      if (!Core.runtime.capabilityProviders[cap]) Core.runtime.capabilityProviders[cap] = id;
    });

    logDebug('module.register', { id: id, moduleVersion: entry.MODULE_VERSION, apiVersion: entry.API_VERSION });
    return ok(entry);
  };

  Core.unregisterModule = function (id) {
    if (!Core.modules[id]) return fail(ERROR_CODES.MODULE_NOT_REGISTERED, 'Module not registered: ' + id, id);
    var entry = Core.modules[id];
    delete Core.modules[id];
    Object.keys(Core.runtime.capabilityProviders).forEach(function (cap) {
      if (Core.runtime.capabilityProviders[cap] === id) delete Core.runtime.capabilityProviders[cap];
    });
    return ok(entry);
  };

  Core.getModule = function (id) { return Core.modules[id] || null; };
  Core.listModules = function () {
    var ids = MODULE_ORDER.concat(Object.keys(Core.modules).filter(function (id) { return MODULE_ORDER.indexOf(id) < 0; }).sort());
    return ids.map(function (id) { return Core.modules[id] || null; });
  };
  Core.hasModule = function (id) { return !!Core.modules[id]; };
  Core.hasCapability = function (capability) { return !!Core.runtime.capabilityProviders[capability]; };
  Core.findProvider = function (capability) { return Core.runtime.capabilityProviders[capability] || null; };

  Core.registerOwnership = function (moduleId, paths) {
    if (!isString(moduleId) || !Array.isArray(paths)) return fail(ERROR_CODES.INVALID_ARGUMENT, 'Invalid ownership registration.', moduleId);
    Core.ownership[moduleId] = paths.slice();
    return ok(Core.ownership[moduleId]);
  };

  Core.validateOwnership = function () {
    var owners = {}, duplicates = [];
    Object.keys(Core.ownership).forEach(function (moduleId) {
      (Core.ownership[moduleId] || []).forEach(function (path) {
        if (owners[path] && owners[path] !== moduleId) duplicates.push({ path: path, owners: [owners[path], moduleId] });
        else owners[path] = moduleId;
      });
    });
    return { ok: duplicates.length === 0, duplicates: duplicates, ownership: safeClone(Core.ownership) };
  };

  Core.validateDependencies = function () {
    var warnings = [];
    Object.keys(Core.modules).forEach(function (id) {
      if (!Core.modules[id]) return;
      (Core.runtime.dependencies[id] || []).forEach(function (dep) {
        if (!Core.modules[dep]) warnings.push({ module: id, missingDependency: dep });
      });
    });
    return { ok: warnings.length === 0, warnings: warnings };
  };

  /* ========================================================================
     6. State Ownership helpers
     ======================================================================== */

  function ownsPath(moduleId, path) {
    var paths = Core.ownership[moduleId] || [];
    var p = String(path || '');
    return paths.some(function (owned) {
      return p === owned || p.indexOf(owned + '.') === 0;
    });
  }

  Core.assertOwnership = function (moduleId, path) {
    if (ownsPath(moduleId, path)) return ok(true);
    return fail(ERROR_CODES.STATE_NOT_OWNED, moduleId + ' does not own state path: ' + path, moduleId, { path: path });
  };

  /* ========================================================================
     7. Service Registry
     ======================================================================== */

  Core.registerService = function (spec) {
    spec = spec || {};
    if (!isString(spec.service) || !isFunction(spec.handler)) return fail(ERROR_CODES.INVALID_ARGUMENT, 'service and handler are required.', spec.module || 'Core');
    if (spec.kind !== 'query' && spec.kind !== 'command') return fail(ERROR_CODES.INVALID_ARGUMENT, 'Service kind must be query or command.', spec.module || 'Core');
    if (Core.runtime.services[spec.service]) return fail(ERROR_CODES.DUPLICATE_SERVICE, 'Service already registered: ' + spec.service, spec.module || 'Core');
    Core.runtime.services[spec.service] = {
      service: spec.service,
      module: spec.module || null,
      kind: spec.kind,
      handler: spec.handler,
      writes: Array.isArray(spec.writes) ? spec.writes.slice() : [],
      version: spec.version || API_VERSION,
      registeredAt: Date.now()
    };
    return ok(Core.runtime.services[spec.service]);
  };

  Core.unregisterService = function (service) {
    if (!Core.runtime.services[service]) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Service not registered: ' + service, 'Core');
    var s = Core.runtime.services[service];
    delete Core.runtime.services[service];
    return ok(s);
  };

  Core.getService = function (service) { return Core.runtime.services[service] || null; };

  function buildQueryState(moduleId) {
    var state = getGameState();
    if (!state) return null;
    var out = {};
    ['time','turn','playerCountryId','countries','worldSeed','modules'].forEach(function (k) {
      if (state[k] !== undefined) out[k] = safeClone(state[k]);
    });
    var providers = [moduleId].concat(Core.runtime.dependencies[moduleId] || []);
    var paths = [];
    providers.forEach(function (id) {
      (Core.ownership[id] || []).forEach(function (p) { if (paths.indexOf(p) < 0) paths.push(p); });
    });
    paths.forEach(function (path) {
      var v = getPath(state, path);
      if (v !== undefined) setPath(out, path, safeClone(v));
    });
    return out;
  }

  function queryContext(service) {
    var state = getGameState();
    return {
      service: service.service,
      module: service.module,
      kind: 'query',
      state: buildQueryState(service.module),
      year: state && state.time ? state.time.year : (state ? state.turn : null),
      getSnapshot: function (modules) { return Core.getSnapshot({ modules: modules }); }
    };
  }

  function commandContext(service) {
    var state = getGameState();
    return {
      service: service.service,
      module: service.module,
      kind: 'command',
      state: state,
      year: state && state.time ? state.time.year : (state ? state.turn : null),
      assertOwnership: function (path) { return Core.assertOwnership(service.module, path); }
    };
  }

  function invokeService(kind, serviceName, payload) {
    var service = Core.runtime.services[serviceName];
    if (!service || service.kind !== kind) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'No ' + kind + ' service: ' + serviceName, service ? service.module : null, { service: serviceName });
    if (service.module && !Core.modules[service.module] && service.module !== 'Core') {
      return fail(ERROR_CODES.MODULE_NOT_REGISTERED, 'Provider module not registered: ' + service.module, service.module, { service: serviceName });
    }
    if (kind === 'command' && service.module && service.module !== 'Core' && service.writes && service.writes.length) {
      var badWrite = service.writes.find(function (path) { return !ownsPath(service.module, path); });
      if (badWrite) return fail(ERROR_CODES.STATE_NOT_OWNED, service.module + ' command is not allowed to write ' + badWrite, service.module, { service: serviceName, path: badWrite });
    }
    var t0 = nowMs();
    try {
      logDebug('api.call', { kind: kind, service: serviceName, module: service.module });
      var result = service.handler(payload == null ? {} : payload, kind === 'query' ? queryContext(service) : commandContext(service));
      if (result && isFunction(result.then)) {
        return result.then(function (v) {
          var out = normalizeResult(v, service.module, { service: serviceName, ms: nowMs() - t0 });
          logDebug('api.return', { kind: kind, service: serviceName, ok: out.ok, ms: nowMs() - t0 });
          return out;
        }).catch(function (e) { return fromException(e, service.module, serviceName); });
      }
      var normalized = normalizeResult(result, service.module, { service: serviceName, ms: nowMs() - t0 });
      logDebug('api.return', { kind: kind, service: serviceName, ok: normalized.ok, ms: nowMs() - t0 });
      return normalized;
    } catch (e) {
      return fromException(e, service.module, serviceName);
    }
  }

  /* ========================================================================
     8. Query Bus
     ======================================================================== */

  Core.query = function (service, request) { return invokeService('query', service, request); };

  /* ========================================================================
     9. Command Bus
     ======================================================================== */

  Core.command = function (service, payload) { return invokeService('command', service, payload); };

  /* ========================================================================
     10. Event Bus
     ======================================================================== */

  var eventListeners = {};
  var eventTokens = {};
  var dispatchStack = [];
  var eventStats = { emitted: 0, delivered: 0, blockedDepth: 0, errors: 0, byName: {} };

  function listenerList(name) {
    if (!eventListeners[name]) eventListeners[name] = [];
    return eventListeners[name];
  }

  var EventBus = {
    MAX_EVENT_DEPTH: MAX_EVENT_DEPTH,

    on: function (name, handler, options) {
      if (!isString(name) || !isFunction(handler)) return function () {};
      var token = makeId('evt_sub');
      var item = { token: token, name: name, handler: handler, once: !!(options && options.once) };
      listenerList(name).push(item);
      eventTokens[token] = item;
      return function () { EventBus.off(name, token); };
    },

    once: function (name, handler) { return EventBus.on(name, handler, { once: true }); },

    off: function (name, handlerOrToken) {
      var list = eventListeners[name] || [];
      var removed = 0;
      eventListeners[name] = list.filter(function (item) {
        var match = item.token === handlerOrToken || item.handler === handlerOrToken;
        if (match) { delete eventTokens[item.token]; removed += 1; }
        return !match;
      });
      return removed;
    },

    emit: function (name, payload, meta) {
      meta = meta || {};
      var parent = dispatchStack.length ? dispatchStack[dispatchStack.length - 1] : null;
      var depth = meta.depth != null ? Number(meta.depth) : (parent ? parent.depth + 1 : 0);
      var state = getGameState();
      var year = meta.year != null ? meta.year : (state && state.time ? state.time.year : (state ? state.turn : null));
      var context = {
        eventId: meta.eventId || makeId('evt'),
        rootEventId: meta.rootEventId || (parent ? parent.rootEventId : null),
        parentEventId: parent ? parent.eventId : (meta.parentEventId || null),
        sourceModule: meta.sourceModule || (parent ? parent.sourceModule : 'Unknown'),
        depth: depth,
        year: year,
        name: name
      };
      if (!context.rootEventId) context.rootEventId = context.eventId;

      if (depth > MAX_EVENT_DEPTH) {
        eventStats.blockedDepth += 1;
        consoleWarn('[BorderEpoch Core] Event depth limit reached; propagation stopped.', context);
        return fail(ERROR_CODES.COMMAND_REJECTED, 'Event propagation depth exceeded MAX_EVENT_DEPTH.', 'Events', { context: context });
      }

      eventStats.emitted += 1;
      eventStats.byName[name] = (eventStats.byName[name] || 0) + 1;
      eventHistory.push({ context: safeClone(context), payload: safeClone(payload) });
      logDebug('event.emit', context);

      var list = (eventListeners[name] || []).slice();
      var delivered = 0;
      dispatchStack.push(context);
      try {
        list.forEach(function (item) {
          try {
            item.handler(payload, safeClone(context));
            delivered += 1;
            eventStats.delivered += 1;
          } catch (e) {
            eventStats.errors += 1;
            consoleError('[BorderEpoch Core] Event handler error', name, e);
          }
          if (item.once) EventBus.off(name, item.token);
        });
      } finally {
        dispatchStack.pop();
      }
      return ok({ eventId: context.eventId, delivered: delivered, depth: context.depth }, { context: context });
    },

    clear: function (name) {
      if (name) {
        (eventListeners[name] || []).forEach(function (item) { delete eventTokens[item.token]; });
        delete eventListeners[name];
      } else {
        eventListeners = {};
        eventTokens = {};
      }
      return ok(true);
    },

    getStats: function () {
      return safeClone({ stats: eventStats, listeners: Object.keys(eventListeners).reduce(function (o, n) { o[n] = eventListeners[n].length; return o; }, {}), recent: eventHistory.values() });
    }
  };

  /* ========================================================================
     11. Tick Coordinator
     ======================================================================== */

  var Tick = {
    runtime: {
      running: false,
      year: null,
      phase: null,
      completedModules: [],
      completedSettlements: {},
      lastReport: null,
      hookPerformance: []
    },
    _hooks: [],
    _officialRunner: null
  };

  function hookKey(h) { return [h.module, h.phase, h.id || '', h.priority].join('|'); }

  Tick.registerHook = function (spec) {
    spec = spec || {};
    if (!isString(spec.module) || !isString(spec.phase) || !isFunction(spec.handler)) return fail(ERROR_CODES.INVALID_ARGUMENT, 'Hook requires module, phase and handler.', spec.module || 'Tick');
    var entry = {
      id: spec.id || makeId('hook'),
      module: spec.module,
      phase: spec.phase,
      priority: isFiniteNumber(spec.priority) ? spec.priority : 100,
      handler: spec.handler,
      managedByOfficialFlow: spec.managedByOfficialFlow !== false,
      extension: spec.extension === true
    };
    if (Tick._hooks.some(function (h) { return hookKey(h) === hookKey(entry); })) return fail(ERROR_CODES.DUPLICATE_HOOK, 'Duplicate tick hook.', entry.module);
    Tick._hooks.push(entry);
    Tick._hooks.sort(function (a, b) { return a.priority - b.priority; });
    return ok(safeClone({ id: entry.id, module: entry.module, phase: entry.phase, priority: entry.priority, managedByOfficialFlow: entry.managedByOfficialFlow, extension: entry.extension }));
  };

  Tick.unregisterHook = function (id) {
    var before = Tick._hooks.length;
    Tick._hooks = Tick._hooks.filter(function (h) { return h.id !== id; });
    return ok({ removed: before - Tick._hooks.length });
  };

  Tick.getHooks = function () {
    return Tick._hooks.map(function (h) { return { id: h.id, module: h.module, phase: h.phase, priority: h.priority, managedByOfficialFlow: h.managedByOfficialFlow, extension: h.extension }; });
  };

  Tick.setOfficialRunner = function (moduleId, runner) {
    if (!isString(moduleId) || !isFunction(runner)) return fail(ERROR_CODES.INVALID_ARGUMENT, 'Official runner requires module and function.', 'Tick');
    Tick._officialRunner = { module: moduleId, runner: runner };
    return ok({ module: moduleId });
  };

  Tick.markSettlement = function (moduleId, phase, year) {
    var key = [year, moduleId, phase].join('|');
    if (Tick.runtime.completedSettlements[key]) {
      consoleWarn('[BorderEpoch Core] duplicate annual settlement', { module: moduleId, phase: phase, year: year });
      return fail(ERROR_CODES.DUPLICATE_TICK, 'Duplicate annual settlement.', moduleId, { phase: phase, year: year });
    }
    Tick.runtime.completedSettlements[key] = true;
    return ok(true);
  };

  function runExtensionHooks(year, state) {
    var hooks = Tick._hooks.filter(function (h) { return h.extension === true || h.managedByOfficialFlow === false; });
    var promise = Promise.resolve([]);
    hooks.forEach(function (hook) {
      promise = promise.then(function (reports) {
        var mark = Tick.markSettlement(hook.module, hook.phase, year);
        if (!mark.ok) { reports.push({ module: hook.module, phase: hook.phase, skipped: true, reason: 'duplicate' }); return reports; }
        Tick.runtime.phase = hook.phase;
        var t0 = nowMs();
        try {
          var value = hook.handler({ year: year, gameState: state, Core: Core, Events: EventBus, Tick: Tick });
          return Promise.resolve(value).then(function (v) {
            var ms = nowMs() - t0;
            Tick.runtime.hookPerformance.push({ module: hook.module, phase: hook.phase, year: year, ms: ms });
            if (Tick.runtime.hookPerformance.length > MAX_DEBUG_RECORDS) Tick.runtime.hookPerformance.splice(0, Tick.runtime.hookPerformance.length - MAX_DEBUG_RECORDS);
            reports.push({ module: hook.module, phase: hook.phase, ok: true, ms: ms, result: safeClone(v) });
            return reports;
          }, function (e) {
            var ms = nowMs() - t0;
            consoleError('[BorderEpoch Core] Tick hook failed', hook.module, hook.phase, e);
            reports.push({ module: hook.module, phase: hook.phase, ok: false, ms: ms, error: String(e) });
            return reports;
          });
        } catch (e) {
          var ms2 = nowMs() - t0;
          consoleError('[BorderEpoch Core] Tick hook failed', hook.module, hook.phase, e);
          reports.push({ module: hook.module, phase: hook.phase, ok: false, ms: ms2, error: String(e) });
          return reports;
        }
      });
    });
    return promise;
  }

  Tick.advanceYear = function (gameState, options) {
    options = options || {};
    if (Tick.runtime.running) return Promise.resolve(fail(ERROR_CODES.ANNUAL_TICK_ALREADY_RUNNING, 'Annual tick is already running.', 'Tick'));
    if (!Tick._officialRunner) return Promise.resolve(fail(ERROR_CODES.API_NOT_AVAILABLE, 'No official annual runner is registered. Core will not invent a second annual flow.', 'Integration'));

    var state = gameState || getGameState();
    var beforeYear = state && state.time ? Number(state.time.year) : (state ? Number(state.turn) : NaN);
    if (!state || !isFinite(beforeYear)) return Promise.resolve(fail(ERROR_CODES.INVALID_STATE, 'A valid gameState with year is required.', 'Tick'));

    if (options.targetYear != null && Number(options.targetYear) <= beforeYear) {
      return Promise.resolve(fail(ERROR_CODES.DUPLICATE_TICK, 'Requested target year has already been settled or is not in the future.', 'Tick', { currentYear: beforeYear, targetYear: Number(options.targetYear) }));
    }

    Tick.runtime.running = true;
    Tick.runtime.year = beforeYear + 1;
    Tick.runtime.phase = 'official';
    Tick.runtime.completedModules = [];
    var started = nowMs();

    var runnerResult;
    try {
      runnerResult = Tick._officialRunner.runner(state, options);
    } catch (e) {
      Tick.runtime.running = false;
      Tick.runtime.phase = null;
      return Promise.resolve(fromException(e, Tick._officialRunner.module, 'advanceYear'));
    }

    return Promise.resolve(runnerResult).then(function (raw) {
      var normalized = normalizeResult(raw, Tick._officialRunner.module, { officialRunner: Tick._officialRunner.module });
      if (!normalized.ok) return normalized;
      var afterState = gameState || getGameState() || state;
      var afterYear = afterState && afterState.time ? Number(afterState.time.year) : Number(afterState.turn);
      if (!isFinite(afterYear) || afterYear !== beforeYear + 1) {
        return fail(ERROR_CODES.INVALID_STATE, 'Official annual runner did not advance exactly one year.', Tick._officialRunner.module, { beforeYear: beforeYear, afterYear: afterYear });
      }
      Tick.runtime.year = afterYear;
      Tick.runtime.completedModules.push(Tick._officialRunner.module);
      return runExtensionHooks(afterYear, afterState).then(function (extensions) {
        var report = {
          year: afterYear,
          officialRunner: Tick._officialRunner.module,
          officialResult: normalized.data,
          extensionHooks: extensions,
          ms: nowMs() - started
        };
        Tick.runtime.lastReport = safeClone(report);
        return ok(report);
      });
    }).catch(function (e) {
      return fromException(e, Tick._officialRunner.module, 'advanceYear');
    }).then(function (result) {
      Tick.runtime.running = false;
      Tick.runtime.phase = null;
      return result;
    });
  };

  Tick.getStatus = function () { return safeClone(Tick.runtime); };
  Tick.validateOrder = function () {
    return {
      ok: !!Tick._officialRunner,
      mode: Tick._officialRunner ? 'wrap_existing_official_flow' : 'no_official_flow',
      officialRunner: Tick._officialRunner ? Tick._officialRunner.module : null,
      note: 'Core intentionally does not duplicate the current Module 8 annual sequence.'
    };
  };

  /* ========================================================================
     12. Adapter Layer
     ======================================================================== */

  function legacyUsed(moduleId, apiName) {
    Core.runtime.legacyAdapterUse[moduleId] = Core.runtime.legacyAdapterUse[moduleId] || {};
    Core.runtime.legacyAdapterUse[moduleId][apiName] = (Core.runtime.legacyAdapterUse[moduleId][apiName] || 0) + 1;
    if (Core.compatibilityMode) consoleWarn('[BorderEpoch Core] legacy adapter used:', moduleId + '.' + apiName);
  }

  function moduleApi(id) {
    return Core.modules[id] ? Core.modules[id].api : null;
  }

  function callLegacy(moduleId, candidates, args, operation) {
    var api = moduleApi(moduleId);
    if (!api) return fail(ERROR_CODES.MODULE_NOT_REGISTERED, 'Module not registered: ' + moduleId, moduleId);
    var found = firstFunction(api, candidates);
    if (!found) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'API not available: ' + moduleId + '.' + operation, moduleId, { candidates: candidates });
    legacyUsed(moduleId, found.path);
    try { return normalizeResult(found.fn.apply(api, args || []), moduleId, { legacyPath: found.path }); }
    catch (e) { return fromException(e, moduleId, operation); }
  }

  function unwrapEnvelope(r) { return looksLikeEnvelope(r) ? r : normalizeResult(r); }

  function stateList(obj) {
    if (!obj) return [];
    return Array.isArray(obj) ? obj.slice() : objectValues(obj);
  }

  function requestArg(request, names, fallback) {
    request = request || {};
    for (var i = 0; i < names.length; i += 1) if (request[names[i]] !== undefined) return request[names[i]];
    return fallback;
  }

  function makeAdapters() {
    Core.adapters.World = {
      getRegion: function (r, ctx) { return ok(safeClone(ctx.state && ctx.state.regions ? ctx.state.regions[r.regionId || r.id] || null : null)); },
      getRegions: function (_, ctx) { return ok(safeClone(ctx.state && ctx.state.regions ? ctx.state.regions : {})); },
      getCity: function (r, ctx) { return ok(safeClone(ctx.state && ctx.state.cities ? ctx.state.cities[r.cityId || r.id] || null : null)); },
      getCities: function (_, ctx) { return ok(safeClone(ctx.state && ctx.state.cities ? ctx.state.cities : {})); },
      getResourceEndowment: function (r, ctx) {
        var api = moduleApi('World');
        if (!api) return fail(ERROR_CODES.MODULE_NOT_REGISTERED, 'World not registered.', 'World');
        var fn = firstFunction(api, ['getResourceEndowment']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'World.getResourceEndowment unavailable.', 'World');
        legacyUsed('World', fn.path);
        try { return ok(fn.fn.call(api, r.regionId, r.resourceType || r.resourceId, ctx.state)); } catch (e) { return fromException(e, 'World', 'getResourceEndowment'); }
      },
      getDiscoveredResources: function (_, ctx) {
        var D = moduleApi('Development');
        if (D && isFunction(D.getDiscoveredDeposits)) {
          legacyUsed('Development', 'getDiscoveredDeposits');
          try { return ok(D.getDiscoveredDeposits(ctx.state)); } catch (e) { return fromException(e, 'Development', 'getDiscoveredDeposits'); }
        }
        return ok(safeClone(ctx.state && ctx.state.discoveredDeposits ? ctx.state.discoveredDeposits : {}), { fallback: 'state_read' });
      }
    };

    Core.adapters.Development = {
      getProject: function (r, ctx) {
        var D = moduleApi('Development');
        if (D && isFunction(D.getProjectInspection)) { legacyUsed('Development', 'getProjectInspection'); try { return ok(D.getProjectInspection(r.projectId || r.id, ctx.state)); } catch (e) { return fromException(e, 'Development', 'getProject'); } }
        return ok(safeClone(ctx.state && ctx.state.projects ? ctx.state.projects[r.projectId || r.id] || null : null));
      },
      getProjects: function (_, ctx) { return ok(safeClone(ctx.state && ctx.state.projects ? ctx.state.projects : {})); },
      getTransportLink: function (r, ctx) {
        var links = firstDefined(getPath(ctx.state, 'transport.links'), getPath(ctx.state, 'connections')) || {};
        return ok(safeClone(links[r.linkId || r.id] || null));
      },
      getTransportNetwork: function (_, ctx) { return ok(safeClone(firstDefined(getPath(ctx.state, 'transport'), getPath(ctx.state, 'connections')) || {})); },
      findTransportRoute: function (r, ctx) {
        var D = moduleApi('Development');
        var fn = firstFunction(D, ['findTransportRoute', 'TransportNetwork.route', 'transport.findRoute']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'No authoritative Module 2 route finder is available yet.', 'Development', { service: 'transport.route' });
        legacyUsed('Development', fn.path);
        try { return ok(fn.fn.call(D, r, ctx.state)); } catch (e) { return fromException(e, 'Development', 'findTransportRoute'); }
      },
      getResourceProjects: function (_, ctx) {
        var projects = ctx.state && ctx.state.projects ? ctx.state.projects : {};
        var out = {};
        Object.keys(projects).forEach(function (id) {
          var p = projects[id];
          var t = String(p && (p.type || p.projectType || p.kind) || '');
          if (/mine|resource|oil|coal|iron|deposit|explor/i.test(t)) out[id] = safeClone(p);
        });
        return ok(out);
      },
      createProject: function (r, ctx) {
        var D = moduleApi('Development');
        var fn = firstFunction(D, ['startProject', 'createProject']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Development project creation API unavailable.', 'Development');
        legacyUsed('Development', fn.path);
        try { return normalizeResult(fn.fn.call(D, r, ctx.state), 'Development', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Development', 'createProject'); }
      },
      cancelProject: function (r, ctx) {
        var D = moduleApi('Development');
        var fn = firstFunction(D, ['cancelProject']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Development.cancelProject unavailable.', 'Development');
        legacyUsed('Development', fn.path);
        try { return normalizeResult(fn.fn.call(D, r.projectId || r.id, ctx.state), 'Development', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Development', 'cancelProject'); }
      },
      upgradeTransportLink: function (r, ctx) {
        var D = moduleApi('Development');
        var fn = firstFunction(D, ['upgradeTransportLink', 'startConnectionUpgrade']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Transport upgrade API unavailable.', 'Development');
        legacyUsed('Development', fn.path);
        try {
          var id = r.linkId || r.connectionId || r.id;
          var level = r.targetLevel != null ? r.targetLevel : r.level;
          return normalizeResult(fn.fn.call(D, id, level, ctx.state), 'Development', { legacyPath: fn.path });
        } catch (e) { return fromException(e, 'Development', 'upgradeTransportLink'); }
      },
      repairTransportLink: function (r, ctx) {
        var D = moduleApi('Development');
        var fn = firstFunction(D, ['repairTransportLink', 'repairConnection']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Transport repair API unavailable.', 'Development');
        legacyUsed('Development', fn.path);
        try { return normalizeResult(fn.fn.call(D, r.linkId || r.id, ctx.state), 'Development', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Development', 'repairTransportLink'); }
      }
    };

    Core.adapters.Economy = {
      getGovernmentFinance: function (r) { return callLegacy('Economy', ['getGovernmentFinance'], [r.countryId], 'getGovernmentFinance'); },
      getTreasury: function (r, ctx) {
        var finance = Core.adapters.Economy.getGovernmentFinance(r, ctx);
        if (finance.ok && finance.data) return ok(firstDefined(finance.data.treasury, finance.data.balance, finance.data.cash, 0));
        var raw = firstDefined(getPath(ctx.state, 'treasury'), getPath(ctx.state, 'economy.treasury'), getPath(ctx.state, 'governmentFinance.treasury'));
        return raw !== undefined ? ok(raw, { fallback: 'state_read' }) : finance;
      },
      getRegionEconomy: function (r) { return callLegacy('Economy', ['getRegionEconomy'], [r.regionId || r.id], 'getRegionEconomy'); },
      getFacilityEconomy: function (r) { return callLegacy('Economy', ['getFacilityEconomy'], [r.facilityId || r.id], 'getFacilityEconomy'); },
      getGoodMarket: function (r) {
        return r.regionId
          ? callLegacy('Economy', ['getRegionGoodBalance'], [r.regionId, r.goodId], 'getGoodMarket')
          : callLegacy('Economy', ['getGoodBalance'], [r.goodId], 'getGoodMarket');
      },
      getPrice: function (r) {
        var q = r.regionId ? callLegacy('Economy', ['getRegionGoodBalance'], [r.regionId, r.goodId], 'getPrice') : callLegacy('Economy', ['getGoodBalance'], [r.goodId], 'getPrice');
        if (!q.ok) return q;
        return ok(q.data ? firstDefined(q.data.price, q.data.marketPrice, q.data.unitPrice, null) : null);
      },
      getInventory: function (r, ctx) {
        var paths = [
          r.regionId ? 'economy.regions.' + r.regionId + '.inventory' : null,
          r.regionId ? 'regions.' + r.regionId + '.inventory' : null,
          'inventory'
        ].filter(Boolean);
        for (var i = 0; i < paths.length; i += 1) {
          var v = getPath(ctx.state, paths[i]);
          if (v !== undefined) return ok(safeClone(r.goodId ? v[r.goodId] : v), { fallback: 'state_read' });
        }
        return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Inventory query is not exposed by the current Economy module.', 'Economy');
      },
      spendTreasury: function (r, ctx) {
        var E = moduleApi('Economy');
        var fn = firstFunction(E, ['spendTreasury', 'Finance.spendTreasury']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Economy has no authoritative spendTreasury command yet; Core refuses to write treasury directly.', 'Economy');
        legacyUsed('Economy', fn.path);
        try { return normalizeResult(fn.fn.call(E, r, ctx.state), 'Economy', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Economy', 'spendTreasury'); }
      },
      receiveRevenue: function (r, ctx) {
        var E = moduleApi('Economy');
        var fn = firstFunction(E, ['receiveRevenue', 'Finance.receiveRevenue']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Economy has no authoritative receiveRevenue command yet; Core refuses to write treasury directly.', 'Economy');
        legacyUsed('Economy', fn.path);
        try { return normalizeResult(fn.fn.call(E, r, ctx.state), 'Economy', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Economy', 'receiveRevenue'); }
      },
      consumeInventory: function (r, ctx) {
        var E = moduleApi('Economy');
        var fn = firstFunction(E, ['consumeInventory', 'Inventory.consume']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Economy has no authoritative consumeInventory command yet; Core refuses to mutate inventory directly.', 'Economy');
        legacyUsed('Economy', fn.path);
        try { return normalizeResult(fn.fn.call(E, r, ctx.state), 'Economy', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Economy', 'consumeInventory'); }
      }
    };

    Core.adapters.Population = {
      getPopulation: function () { return callLegacy('Population', ['snapshot', 'getDebugSnapshot'], [], 'getPopulation'); },
      getCityPopulation: function (r) { return callLegacy('Population', ['getCityPopulation'], [r.cityId || r.id], 'getCityPopulation'); },
      getLaborSupply: function (r) {
        var q = callLegacy('Population', ['getRegionSociety'], [r.regionId || r.id], 'getLaborSupply');
        if (!q.ok) return q;
        return ok(q.data ? firstDefined(q.data.laborSupply, q.data.workforce, q.data.workingAgePopulation, null) : null);
      },
      getHousingStatus: function (r) {
        var q = callLegacy('Population', ['getCityPopulation', 'getRegionSociety'], [r.cityId || r.regionId || r.id], 'getHousingStatus');
        if (!q.ok) return q;
        return ok(q.data ? firstDefined(q.data.housingStatus, q.data.housing, q.data.housingPressure, null) : null);
      }
    };

    Core.adapters.Trade = {
      getTradeContracts: function (_, ctx) { return ok(safeClone(firstDefined(getPath(ctx.state, 'tradeContracts'), getPath(ctx.state, 'trade.contracts')) || {}), { fallback: 'state_read' }); },
      getTradeRoutes: function (_, ctx) { return ok(safeClone(firstDefined(getPath(ctx.state, 'tradeRoutes'), getPath(ctx.state, 'trade.routes')) || {}), { fallback: 'state_read' }); },
      getImportNeed: function (r) { return callLegacy('Trade', ['getImportNeed'], [r.countryId, r.goodId], 'getImportNeed'); },
      getExportableSupply: function (r) { return callLegacy('Trade', ['getPotentialSurplus'], [r.countryId, r.goodId], 'getExportableSupply'); },
      getRelationship: function (r) { return callLegacy('Trade', ['getRelationship'], [r.countryA || r.fromCountryId, r.countryB || r.toCountryId], 'getRelationship'); },
      requestQuote: function (r, ctx) {
        var T = moduleApi('Trade'); var fn = firstFunction(T, ['requestQuote', 'getSpotBid']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Trade quote API unavailable.', 'Trade');
        legacyUsed('Trade', fn.path);
        try {
          if (fn.path === 'getSpotBid') {
            return normalizeResult(fn.fn.call(T,
              r.exporterId || r.sellerCountryId || r.fromCountryId,
              r.importerId || r.buyerCountryId || r.toCountryId,
              r.goodId,
              Number(r.tariffRate || 0),
              Number(r.exportTaxRate || 0),
              ctx.state
            ), 'Trade', { legacyPath: fn.path });
          }
          return normalizeResult(fn.fn.call(T, r, ctx.state), 'Trade', { legacyPath: fn.path });
        } catch (e) { return fromException(e, 'Trade', 'requestQuote'); }
      },
      createContract: function (r, ctx) {
        var T = moduleApi('Trade'); var fn = firstFunction(T, ['createContract', 'createAgreement']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Trade contract creation API unavailable.', 'Trade');
        legacyUsed('Trade', fn.path);
        try { return normalizeResult(fn.fn.call(T, r, ctx.state), 'Trade', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Trade', 'createContract'); }
      },
      cancelContract: function (r, ctx) {
        var T = moduleApi('Trade'); var fn = firstFunction(T, ['cancelContract', 'breakAgreement']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Trade contract cancellation API unavailable.', 'Trade');
        legacyUsed('Trade', fn.path);
        try {
          if (fn.path === 'breakAgreement') {
            return normalizeResult(fn.fn.call(T, r.contractId || r.agreementId || r.id, r.breakerCountryId || r.countryId, ctx.state), 'Trade', { legacyPath: fn.path });
          }
          return normalizeResult(fn.fn.call(T, r.contractId || r.id, ctx.state), 'Trade', { legacyPath: fn.path });
        } catch (e) { return fromException(e, 'Trade', 'cancelContract'); }
      }
    };

    Core.adapters.AI = {
      getCountryIntent: function (r) { return callLegacy('AI', ['getState', 'getDecisionExplanation'], [r.countryId], 'getCountryIntent'); },
      getCountryDecision: function (r) { return callLegacy('AI', ['getDecisionExplanation', 'getState'], [r.countryId], 'getCountryDecision'); },
      getAIStatus: function (r) { return callLegacy('AI', ['getDebugSnapshot', 'getState'], [r.countryId], 'getAIStatus'); }
    };

    Core.adapters.Events = {
      getActiveEvents: function (_, ctx) {
        var E = moduleApi('Events'); var fn = firstFunction(E, ['getCurrentSituations', 'getActiveEvents', 'getNextEvent']);
        if (fn) { legacyUsed('Events', fn.path); try { return ok(fn.fn.call(E, ctx.state)); } catch (e) { return fromException(e, 'Events', 'getActiveEvents'); } }
        return ok(safeClone(firstDefined(getPath(ctx.state, 'events'), getPath(ctx.state, 'issues')) || []), { fallback: 'state_read' });
      },
      getEventHistory: function (_, ctx) {
        var E = moduleApi('Events'); var fn = firstFunction(E, ['getFeed', 'getEventHistory', 'getDebuggerSnapshot']);
        if (fn) { legacyUsed('Events', fn.path); try { return ok(fn.fn.call(E, ctx.state)); } catch (e) { return fromException(e, 'Events', 'getEventHistory'); } }
        return ok(safeClone(getPath(ctx.state, 'history') || []), { fallback: 'state_read' });
      }
    };

    Core.adapters.Integration = {
      getCurrentView: function () {
        var I = moduleApi('Integration'); var fn = firstFunction(I, ['getCurrentView']);
        if (fn) { legacyUsed('Integration', fn.path); try { return ok(fn.fn.call(I)); } catch (e) { return fromException(e, 'Integration', 'getCurrentView'); } }
        return ok(null, { unavailable: true });
      },
      navigateTo: function (r) {
        var I = moduleApi('Integration'); var fn = firstFunction(I, ['navigateTo']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Integration navigation API unavailable.', 'Integration');
        legacyUsed('Integration', fn.path); try { return normalizeResult(fn.fn.call(I, r), 'Integration'); } catch (e) { return fromException(e, 'Integration', 'navigateTo'); }
      },
      refreshUI: function (r) {
        var I = moduleApi('Integration'); var fn = firstFunction(I, ['refreshUI']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Integration refreshUI API unavailable.', 'Integration');
        legacyUsed('Integration', fn.path); try { return normalizeResult(fn.fn.call(I, r), 'Integration'); } catch (e) { return fromException(e, 'Integration', 'refreshUI'); }
      },
      advanceYear: function (r, ctx) {
        var I = moduleApi('Integration'); var fn = firstFunction(I, ['advanceOneYear']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Module 8 official advanceOneYear API unavailable.', 'Integration');
        legacyUsed('Integration', fn.path);
        try {
          var session = r && r.session !== undefined ? r.session : undefined;
          var extra = r && r.extra ? r.extra : {};
          return Promise.resolve(fn.fn.call(I, session, extra)).then(function (v) { return normalizeResult(v, 'Integration', { legacyPath: fn.path }); });
        } catch (e) { return fromException(e, 'Integration', 'advanceYear'); }
      }
    };

    Core.adapters.Agriculture = {
      getRegionalAgriculture: function (r, ctx) {
        var A = moduleApi('Agriculture'); var fn = firstFunction(A, ['getRegion']);
        if (fn) { legacyUsed('Agriculture', fn.path); try { return ok(fn.fn.call(A, ctx.state && ctx.state.agriculture ? ctx.state.agriculture : ctx.state, r.regionId || r.id)); } catch (e) { return fromException(e, 'Agriculture', 'getRegionalAgriculture'); } }
        return ok(safeClone(getPath(ctx.state, 'agriculture.regions.' + (r.regionId || r.id)) || null));
      },
      getFoodSupply: function (r, ctx) {
        var A = moduleApi('Agriculture'); var fn = firstFunction(A, ['getAvailableSupply']);
        if (fn) {
          legacyUsed('Agriculture', fn.path);
          try {
            var agState = ctx.state && ctx.state.agriculture ? ctx.state.agriculture : ctx.state;
            var region = agState && agState.regions ? agState.regions[r.regionId] : null;
            return ok(fn.fn.call(A, region, null, r.goodId || r.cropId || 'food'));
          } catch (e) { return fromException(e, 'Agriculture', 'getFoodSupply'); }
        }
        return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Agriculture food supply query unavailable.', 'Agriculture');
      },
      getCropStatus: function (r, ctx) {
        var region = getPath(ctx.state, 'agriculture.regions.' + r.regionId);
        return ok(safeClone(region && region.crops ? region.crops[r.cropId] || null : null));
      },
      getFarmInventory: function (r, ctx) {
        var region = getPath(ctx.state, 'agriculture.regions.' + r.regionId);
        return ok(safeClone(region && region.storage ? region.storage : null));
      },
      getAgriculturalFreightDemand: function (_, ctx) {
        var A = moduleApi('Agriculture'); var fn = firstFunction(A, ['getOutputs']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Agriculture.getOutputs unavailable.', 'Agriculture');
        legacyUsed('Agriculture', fn.path);
        try { return ok(fn.fn.call(A, ctx.state && ctx.state.agriculture ? ctx.state.agriculture : ctx.state)); } catch (e) { return fromException(e, 'Agriculture', 'getAgriculturalFreightDemand'); }
      },
      getAgricultureDiagnostics: function (_, ctx) {
        var A = moduleApi('Agriculture'); var fn = firstFunction(A, ['validateState']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Agriculture.validateState unavailable.', 'Agriculture');
        legacyUsed('Agriculture', fn.path);
        try { return ok({ errors: fn.fn.call(A, ctx.state && ctx.state.agriculture ? ctx.state.agriculture : ctx.state, false) }); } catch (e) { return fromException(e, 'Agriculture', 'getAgricultureDiagnostics'); }
      },
      createStateProject: function (r, ctx) {
        var A = moduleApi('Agriculture'); var fn = firstFunction(A, ['startStateAgricultureProject']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Agriculture state-project API unavailable.', 'Agriculture');
        legacyUsed('Agriculture', fn.path);
        try {
          var agState = ctx.state && ctx.state.agriculture ? ctx.state.agriculture : ctx.state;
          return normalizeResult(fn.fn.call(A, agState, r.type || r.projectType, r.regionId, r.parameters || r.params || {}, r.currentYear || ctx.year), 'Agriculture', { legacyPath: fn.path });
        } catch (e) { return fromException(e, 'Agriculture', 'createStateProject'); }
      },
      setPolicy: function (r, ctx) {
        var A = moduleApi('Agriculture'); var fn = firstFunction(A, ['setAgriculturePolicy']);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Agriculture policy API unavailable.', 'Agriculture');
        legacyUsed('Agriculture', fn.path);
        try {
          var agState = ctx.state && ctx.state.agriculture ? ctx.state.agriculture : ctx.state;
          return normalizeResult(fn.fn.call(A, agState, r.key || r.policy, r.value), 'Agriculture', { legacyPath: fn.path });
        } catch (e) { return fromException(e, 'Agriculture', 'setPolicy'); }
      }
    };

    Core.adapters.Research = {
      _resolve: function () {
        return moduleApi('Research') || BorderEpoch.Research || global.Research || global.ResearchForgeBridge || BorderEpoch.ResearchForgeBridge || null;
      },
      _query: function (names, r, op) {
        var R = Core.adapters.Research._resolve(); var fn = firstFunction(R, names);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Research API unavailable: ' + op, 'Research');
        legacyUsed('Research', fn.path);
        try { return normalizeResult(fn.fn.call(R, r), 'Research', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Research', op); }
      },
      _command: function (names, r, ctx, op) {
        var R = Core.adapters.Research._resolve(); var fn = firstFunction(R, names);
        if (!fn) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Research command unavailable: ' + op, 'Research');
        legacyUsed('Research', fn.path);
        try { return normalizeResult(fn.fn.call(R, r, ctx.state), 'Research', { legacyPath: fn.path }); } catch (e) { return fromException(e, 'Research', op); }
      },
      getCapability: function (r) { return Core.adapters.Research._query(['getCapability', 'query.getCapability'], r, 'getCapability'); },
      getCapabilities: function (r) { return Core.adapters.Research._query(['getCapabilities', 'query.getCapabilities'], r, 'getCapabilities'); },
      getResearchStatus: function (r) { return Core.adapters.Research._query(['getResearchStatus', 'getStatus', 'query.getResearchStatus'], r, 'getResearchStatus'); },
      getProblems: function (r) { return Core.adapters.Research._query(['getProblems', 'query.getProblems'], r, 'getProblems'); },
      getProjects: function (r) { return Core.adapters.Research._query(['getProjects', 'query.getProjects'], r, 'getProjects'); },
      getEngineeringPossibilities: function (r) { return Core.adapters.Research._query(['getEngineeringPossibilities', 'query.getEngineeringPossibilities'], r, 'getEngineeringPossibilities'); },
      getModifier: function (r) { return Core.adapters.Research._query(['getModifier', 'query.getModifier'], r, 'getModifier'); },
      reportObservation: function (r, ctx) { return Core.adapters.Research._command(['reportObservation', 'command.reportObservation'], r, ctx, 'reportObservation'); },
      reportNeed: function (r, ctx) { return Core.adapters.Research._command(['reportNeed', 'command.reportNeed'], r, ctx, 'reportNeed'); },
      reportExperience: function (r, ctx) { return Core.adapters.Research._command(['reportExperience', 'command.reportExperience'], r, ctx, 'reportExperience'); },
      startProject: function (r, ctx) { return Core.adapters.Research._command(['startProject', 'command.startProject'], r, ctx, 'startProject'); },
      startPrototype: function (r, ctx) { return Core.adapters.Research._command(['startPrototype', 'command.startPrototype'], r, ctx, 'startPrototype'); }
    };
  }

  /* ========================================================================
     13. Legacy Module Detection / API namespace construction
     ======================================================================== */

  var APIs = {};

  function ensureApiNamespace(moduleId) {
    if (!APIs[moduleId]) {
      APIs[moduleId] = {
        VERSION: API_VERSION,
        MODULE_VERSION: null,
        API_VERSION: API_VERSION,
        query: {},
        command: {},
        events: {},
        annual: {}
      };
    }
    return APIs[moduleId];
  }

  MODULE_ORDER.forEach(ensureApiNamespace);

  function moduleCandidate(id) {
    switch (id) {
      case 'World': return global.World || BorderEpoch.World || null;
      case 'Development': return global.Development || BorderEpoch.Development || null;
      case 'Economy': return global.Economy || BorderEpoch.Economy || null;
      case 'Population': return global.Population || BorderEpoch.Population || null;
      case 'Trade': return global.TradeDiplomacy || BorderEpoch.Trade || null;
      case 'AI': return global.CountryAI || BorderEpoch.AI || null;
      case 'Events': return global.IssuesEvents || BorderEpoch.IssuesEvents || null;
      case 'Integration': return BorderEpoch.Integration || BorderEpoch.Module8 || global.BorderEpochIntegration || null;
      case 'Agriculture': return BorderEpoch.Agriculture || global.Agriculture || null;
      case 'Research': return BorderEpoch.Research || global.Research || global.ResearchForgeBridge || BorderEpoch.ResearchForgeBridge || null;
      default: return null;
    }
  }

  function stateNamespaceFor(id) {
    return {
      World: 'world', Development: 'development', Economy: 'economy', Population: 'population', Trade: 'trade',
      AI: 'aiCountries', Events: 'events', Integration: 'integration', Agriculture: 'agriculture', Research: 'research'
    }[id];
  }

  Core.registerExistingModules = function () {
    Core.runtime.moduleScanCount += 1;
    var report = {};
    MODULE_ORDER.forEach(function (id) {
      if (Core.modules[id]) { report[id] = { registered: true, reason: 'already_registered' }; return; }
      var api = moduleCandidate(id);
      if (!api) {
        Core.runtime.failedRegistrations[id] = { registered: false, reason: 'module_not_loaded', at: Date.now() };
        Core.runtime.missingModules[id] = true;
        report[id] = { registered: false, reason: 'module_not_loaded' };
        return;
      }
      var res = Core.registerModule({
        id: id,
        version: firstDefined(api.MODULE_VERSION, api.VERSION, '0.0.0'),
        API_VERSION: firstDefined(api.API_VERSION, API_VERSION),
        api: api,
        stateNamespace: stateNamespaceFor(id),
        capabilities: DEFAULT_CAPABILITIES[id],
        dependencies: DEFAULT_DEPENDENCIES[id],
        annualHooks: {
          prepareYear: api.prepareYear,
          simulateYear: api.simulateYear,
          finalizeYear: api.finalizeYear
        }
      });
      report[id] = res.ok ? { registered: true, version: Core.modules[id].MODULE_VERSION } : { registered: false, reason: res.error && res.error.code };
      if (res.ok) {
        var ns = ensureApiNamespace(id);
        ns.MODULE_VERSION = Core.modules[id].MODULE_VERSION;
        ns.API_VERSION = Core.modules[id].API_VERSION;
        ns.VERSION = Core.modules[id].API_VERSION;
      }
    });

    /* Current formal time owner is Module 8. Do not duplicate its M2/M9/M3/... sequence. */
    var I = Core.modules.Integration && Core.modules.Integration.api;
    if (I && isFunction(I.advanceOneYear)) {
      Tick.setOfficialRunner('Integration', function (_, options) {
        return Core.adapters.Integration.advanceYear({ session: options && options.session, extra: options && options.extra || {} }, commandContext({ service: 'integration.annual.advance', module: 'Integration' }));
      });
    }

    return ok(report, { dependencies: Core.validateDependencies() });
  };

  function defaultWritePaths(moduleId, service) {
    if (moduleId === 'Development') return /transport/.test(service) ? ['transport', 'connections'] : ['projects'];
    if (moduleId === 'Economy') return /treasury/.test(service) ? ['economy', 'treasury'] : (/inventory/.test(service) ? ['economy', 'inventory'] : ['economy']);
    if (moduleId === 'Trade') return ['trade'];
    if (moduleId === 'Agriculture') return ['agriculture'];
    if (moduleId === 'Research') return ['research'];
    return [];
  }

  function addService(service, moduleId, kind, adapterMethod) {
    if (Core.runtime.services[service]) return;
    Core.registerService({
      service: service,
      module: moduleId,
      kind: kind,
      writes: kind === 'command' ? defaultWritePaths(moduleId, service) : [],
      handler: function (payload, ctx) {
        var adapter = Core.adapters[moduleId];
        if (!adapter || !isFunction(adapter[adapterMethod])) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'Adapter unavailable: ' + moduleId + '.' + adapterMethod, moduleId);
        return adapter[adapterMethod](payload || {}, ctx);
      }
    });
  }

  function bindApi(moduleId, type, method, service) {
    var ns = ensureApiNamespace(moduleId);
    ns[type][method] = type === 'query'
      ? function (request) { return Core.query(service, request || {}); }
      : function (payload) { return Core.command(service, payload || {}); };
  }

  function buildServicesAndApis() {
    /* M1 */
    [['getRegion','world.region'],['getRegions','world.regions'],['getCity','world.city'],['getCities','world.cities'],['getResourceEndowment','world.resourceEndowment'],['getDiscoveredResources','world.discoveredResources']].forEach(function (x) { addService(x[1],'World','query',x[0]); bindApi('World','query',x[0],x[1]); });

    /* M2 */
    [['getProject','development.project'],['getProjects','development.projects'],['getTransportLink','transport.link'],['getTransportNetwork','transport.network'],['findTransportRoute','transport.route'],['getResourceProjects','resource.projects']].forEach(function (x) { addService(x[1],'Development','query',x[0]); bindApi('Development','query',x[0],x[1]); });
    [['createProject','development.project.create'],['cancelProject','development.project.cancel'],['upgradeTransportLink','transport.link.upgrade'],['repairTransportLink','transport.link.repair']].forEach(function (x) { addService(x[1],'Development','command',x[0]); bindApi('Development','command',x[0],x[1]); });
    APIs.Development.command.buildRailway = function (p) { p = p || {}; p.type = p.type || 'railway'; return Core.command('development.project.create', p); };
    APIs.Development.command.requestTransportUpgrade = APIs.Development.command.upgradeTransportLink;

    /* M3 */
    [['getGovernmentFinance','economy.finance'],['getTreasury','economy.treasury'],['getRegionEconomy','economy.region'],['getFacilityEconomy','economy.facility'],['getGoodMarket','economy.good.market'],['getPrice','economy.price'],['getInventory','economy.inventory']].forEach(function (x) { addService(x[1],'Economy','query',x[0]); bindApi('Economy','query',x[0],x[1]); });
    [['spendTreasury','economy.treasury.spend'],['receiveRevenue','economy.treasury.receive'],['consumeInventory','economy.inventory.consume']].forEach(function (x) { addService(x[1],'Economy','command',x[0]); bindApi('Economy','command',x[0],x[1]); });

    /* M4 */
    [['getPopulation','population.all'],['getCityPopulation','population.city'],['getLaborSupply','population.labor'],['getHousingStatus','population.housing']].forEach(function (x) { addService(x[1],'Population','query',x[0]); bindApi('Population','query',x[0],x[1]); });

    /* M5 */
    [['getTradeContracts','trade.contracts'],['getTradeRoutes','trade.routes'],['getImportNeed','trade.importNeed'],['getExportableSupply','trade.exportableSupply'],['getRelationship','diplomacy.relationship']].forEach(function (x) { addService(x[1],'Trade','query',x[0]); bindApi('Trade','query',x[0],x[1]); });
    [['requestQuote','trade.quote.request'],['createContract','trade.contract.create'],['cancelContract','trade.contract.cancel']].forEach(function (x) { addService(x[1],'Trade','command',x[0]); bindApi('Trade','command',x[0],x[1]); });

    /* M6 */
    [['getCountryIntent','ai.country.intent'],['getCountryDecision','ai.country.decision'],['getAIStatus','ai.status']].forEach(function (x) { addService(x[1],'AI','query',x[0]); bindApi('AI','query',x[0],x[1]); });

    /* M7 */
    [['getActiveEvents','events.active'],['getEventHistory','events.history']].forEach(function (x) { addService(x[1],'Events','query',x[0]); bindApi('Events','query',x[0],x[1]); });

    /* M8 */
    [['getCurrentView','integration.view']].forEach(function (x) { addService(x[1],'Integration','query',x[0]); bindApi('Integration','query',x[0],x[1]); });
    [['navigateTo','integration.navigate'],['refreshUI','integration.refresh']].forEach(function (x) { addService(x[1],'Integration','command',x[0]); bindApi('Integration','command',x[0],x[1]); });
    APIs.Integration.annual.advanceYear = function (state, options) { return Tick.advanceYear(state, options || {}); };

    /* M9 */
    [['getRegionalAgriculture','agriculture.region'],['getFoodSupply','agriculture.foodSupply'],['getCropStatus','agriculture.crop'],['getFarmInventory','agriculture.inventory'],['getAgriculturalFreightDemand','agriculture.freightDemand'],['getAgricultureDiagnostics','agriculture.diagnostics']].forEach(function (x) { addService(x[1],'Agriculture','query',x[0]); bindApi('Agriculture','query',x[0],x[1]); });
    [['createStateProject','agriculture.stateProject.create'],['setPolicy','agriculture.policy.set']].forEach(function (x) { addService(x[1],'Agriculture','command',x[0]); bindApi('Agriculture','command',x[0],x[1]); });

    /* M10 */
    [['getCapability','research.capability'],['getCapabilities','research.capabilities'],['getResearchStatus','research.status'],['getProblems','research.problems'],['getProjects','research.projects'],['getEngineeringPossibilities','research.engineeringPossibilities'],['getModifier','research.modifier']].forEach(function (x) { addService(x[1],'Research','query',x[0]); bindApi('Research','query',x[0],x[1]); });
    [['reportObservation','research.observation.report'],['reportNeed','research.need.report'],['reportExperience','research.experience.report'],['startProject','research.project.start'],['startPrototype','research.prototype.start']].forEach(function (x) { addService(x[1],'Research','command',x[0]); bindApi('Research','command',x[0],x[1]); });

    /* Event facade in every module namespace. */
    MODULE_ORDER.forEach(function (id) {
      APIs[id].events.emit = function (name, payload, meta) { meta = meta || {}; if (!meta.sourceModule) meta.sourceModule = id; return EventBus.emit(name, payload, meta); };
      APIs[id].events.on = EventBus.on;
      APIs[id].events.once = EventBus.once;
      APIs[id].events.off = EventBus.off;
    });
  }

  /* ========================================================================
     14. Snapshot / Version / Deprecation / Migration
     ======================================================================== */

  Core.getSnapshot = function (options) {
    options = options || {};
    var state = getGameState();
    if (!state) return fail(ERROR_CODES.INVALID_STATE, 'gameState is unavailable.', 'Core');
    var modules = Array.isArray(options.modules) && options.modules.length ? options.modules : MODULE_ORDER.slice();
    var snapshot = { year: state.time ? state.time.year : state.turn, modules: {} };
    modules.forEach(function (moduleId) {
      if (MODULE_ORDER.indexOf(moduleId) < 0) return;
      var owned = {};
      (Core.ownership[moduleId] || []).forEach(function (path) {
        var v = getPath(state, path);
        if (v !== undefined) owned[path] = safeClone(v);
      });
      snapshot.modules[moduleId] = owned;
    });
    if (options.freeze !== false) deepFreeze(snapshot);
    return ok(snapshot);
  };

  Core.compareSemver = compareSemver;
  Core.requireApiVersion = function (moduleId, minimum, maximumExclusive) {
    var m = Core.modules[moduleId];
    if (!m) return fail(ERROR_CODES.MODULE_NOT_REGISTERED, 'Module not registered: ' + moduleId, moduleId);
    if (minimum && compareSemver(m.API_VERSION, minimum) < 0) return fail(ERROR_CODES.VERSION_MISMATCH, moduleId + ' API ' + m.API_VERSION + ' is below required ' + minimum, moduleId);
    if (maximumExclusive && compareSemver(m.API_VERSION, maximumExclusive) >= 0) return fail(ERROR_CODES.VERSION_MISMATCH, moduleId + ' API ' + m.API_VERSION + ' is not below ' + maximumExclusive, moduleId);
    return ok({ module: moduleId, apiVersion: m.API_VERSION });
  };

  Core.deprecate = function (spec) {
    spec = spec || {};
    if (!spec.module || !spec.api) return fail(ERROR_CODES.INVALID_ARGUMENT, 'deprecate requires module and api.', 'Core');
    Core.runtime.deprecations.push({ module: spec.module, api: spec.api, replacement: spec.replacement || null, removeAfter: spec.removeAfter || null, at: Date.now() });
    return ok(true);
  };

  Core.warnDeprecated = function (moduleId, apiName) {
    Core.runtime.deprecations.filter(function (d) { return d.module === moduleId && d.api === apiName; }).forEach(function (d) {
      consoleWarn('[BorderEpoch Core] Deprecated API:', moduleId + '.' + apiName, d.replacement ? 'Use ' + d.replacement : '', d.removeAfter ? 'Remove after ' + d.removeAfter : '');
    });
  };

  Core.registerMigration = function (spec) {
    spec = spec || {};
    if (!spec.module || !spec.from || !spec.to || !isFunction(spec.migrate)) return fail(ERROR_CODES.INVALID_ARGUMENT, 'Invalid migration specification.', spec.module || 'Core');
    Core.runtime.migrations[spec.module] = Core.runtime.migrations[spec.module] || [];
    Core.runtime.migrations[spec.module].push({ from: spec.from, to: spec.to, migrate: spec.migrate });
    return ok(true);
  };

  Core.getModuleStateVersion = function (moduleId, state) {
    state = state || getGameState();
    var ns = stateNamespaceFor(moduleId);
    var sub = ns ? getPath(state, ns) : null;
    return sub && firstDefined(sub.stateVersion, sub.version, sub.VERSION) || (Core.modules[moduleId] ? Core.modules[moduleId].MODULE_VERSION : null);
  };

  Core.migrateModuleState = function (moduleId, from, to, moduleState) {
    var list = Core.runtime.migrations[moduleId] || [];
    var exact = list.find(function (m) { return m.from === from && m.to === to; });
    if (!exact) return fail(ERROR_CODES.API_NOT_AVAILABLE, 'No migration registered for ' + moduleId + ' ' + from + ' -> ' + to, moduleId);
    try { return ok(exact.migrate(safeClone(moduleState))); } catch (e) { return fromException(e, moduleId, 'migrateModuleState'); }
  };

  /* ========================================================================
     15. Diagnostics
     ======================================================================== */

  function getMissingModules() {
    return MODULE_ORDER.filter(function (id) { return !Core.modules[id]; }).map(function (id) {
      return { id: id, reason: (Core.runtime.failedRegistrations[id] && Core.runtime.failedRegistrations[id].reason) || 'not_registered' };
    });
  }

  function apiHealth() {
    var out = {};
    MODULE_ORDER.forEach(function (id) {
      var ns = APIs[id];
      out[id] = {
        registered: !!Core.modules[id],
        moduleVersion: Core.modules[id] ? Core.modules[id].MODULE_VERSION : null,
        apiVersion: ns.API_VERSION,
        queryCount: Object.keys(ns.query).length,
        commandCount: Object.keys(ns.command).length,
        capabilityCount: (Core.modules[id] ? Core.modules[id].capabilities : DEFAULT_CAPABILITIES[id] || []).length
      };
    });
    return out;
  }

  function legacyCounts() {
    var out = {};
    Object.keys(Core.runtime.legacyAdapterUse).forEach(function (id) {
      var map = Core.runtime.legacyAdapterUse[id];
      out[id] = Object.keys(map).reduce(function (sum, k) { return sum + map[k]; }, 0);
    });
    return out;
  }

  Core.Diagnostics = {
    getRegisteredModules: function () { return Object.keys(Core.modules).sort(function (a,b) { var ia=MODULE_ORDER.indexOf(a), ib=MODULE_ORDER.indexOf(b); if(ia<0)ia=999; if(ib<0)ib=999; return ia===ib?(a>b?1:-1):ia-ib; }).map(function (id) { return safeClone(Core.modules[id]); }); },
    getMissingModules: getMissingModules,
    getDependencies: function () { return safeClone(Core.runtime.dependencies); },
    getAPIHealth: apiHealth,
    getEventStats: function () { return EventBus.getStats(); },
    getTickStatus: function () { return Tick.getStatus(); },
    getStateOwnership: function () { return safeClone(Core.ownership); },
    getDebugLog: function () { return debugBuffer.values(); },
    getLegacyAdapterUse: legacyCounts,
    clearDebugLog: function () { debugBuffer.clear(); return ok(true); },
    runSelfCheck: function () { return Core.runSelfCheck(); },
    printHealth: function () {
      var health = apiHealth();
      var self = Core.runSelfCheck();
      if (global.console && isFunction(global.console.log)) {
        global.console.log('Border Epoch Core API ' + CORE_VERSION);
        MODULE_ORDER.forEach(function (id) { global.console.log(id.padEnd ? id.padEnd(15, ' ') : id, health[id].registered ? 'OK' : 'MISSING'); });
        global.console.log('Event Bus      OK');
        global.console.log('Annual Tick    ' + (Tick._officialRunner ? 'OK' : 'NO OFFICIAL RUNNER'));
        global.console.log('Ownership      ' + (Core.validateOwnership().ok ? 'OK' : 'ERROR'));
        global.console.log('Legacy adapters:', legacyCounts());
        global.console.log('Errors:', self.errors.length, 'Warnings:', self.warnings.length);
      }
      return self;
    }
  };

  /* ========================================================================
     16. Self Tests
     ======================================================================== */

  Core.runSelfCheck = function () {
    var checks = [];
    var warnings = [];
    var errors = [];

    function check(id, fn, warningOnly) {
      try {
        var detail = fn();
        var pass = detail === true || (isObject(detail) && detail.pass !== false && detail.ok !== false);
        checks.push({ id: id, pass: pass, detail: detail === true ? null : safeClone(detail) });
        if (!pass) (warningOnly ? warnings : errors).push({ id: id, detail: safeClone(detail) });
      } catch (e) {
        checks.push({ id: id, pass: false, error: String(e) });
        (warningOnly ? warnings : errors).push({ id: id, error: String(e) });
      }
    }

    /* Core initialization and fixed IDs. */
    check('core_initialized', function () { return { pass: !!BorderEpoch && !!Core && !!APIs && !!EventBus && !!Tick }; });
    check('module_ids_10_unique', function () {
      var vals = Object.keys(MODULE_IDS).map(function (k) { return MODULE_IDS[k]; });
      return { pass: vals.length === 10 && new Set(vals).size === 10, ids: vals };
    });

    /* A: registry cannot accept duplicate live id with a different api. */
    check('test_A_module_registry_duplicate_guard', function () {
      var existingId = MODULE_ORDER.find(function (id) { return !!Core.modules[id]; });
      if (!existingId) return { pass: true, skipped: true, reason: 'no_live_module_loaded' };
      var r = Core.registerModule({ id: existingId, api: {}, version: '0.0.0' });
      return { pass: !r.ok && r.error.code === ERROR_CODES.DUPLICATE_MODULE_ID, module: existingId };
    });

    /* Missing live modules are warnings, never fatal. */
    check('module_registry_live_status', function () {
      var missing = getMissingModules();
      if (missing.length) warnings.push({ id: 'missing_modules', modules: missing });
      return { pass: true, registered: MODULE_ORDER.length - missing.length, missing: missing };
    }, true);

    /* B: nonexistent query does not throw. */
    check('test_B_missing_api_isolated', function () {
      var r = Core.query('transport.nonexistent', {});
      return { pass: !!r && r.ok === false && r.error && r.error.code === ERROR_CODES.API_NOT_AVAILABLE };
    });

    /* C: subscribe / emit / unsubscribe. */
    check('test_C_event_subscribe_unsubscribe', function () {
      var name = '__core_selftest.event'; var count = 0;
      var unsub = EventBus.on(name, function () { count += 1; });
      EventBus.emit(name, { n: 1 }, { sourceModule: 'Core' });
      unsub();
      EventBus.emit(name, { n: 2 }, { sourceModule: 'Core' });
      EventBus.clear(name);
      return { pass: count === 1, received: count };
    });

    /* once() */
    check('event_once', function () {
      var name = '__core_selftest.once'; var count = 0;
      EventBus.once(name, function () { count += 1; });
      EventBus.emit(name, {}, { sourceModule: 'Core' });
      EventBus.emit(name, {}, { sourceModule: 'Core' });
      EventBus.clear(name);
      return { pass: count === 1, received: count };
    });

    /* D: nested loop stops at MAX_EVENT_DEPTH. */
    check('test_D_event_depth_guard', function () {
      var name = '__core_selftest.loop'; var count = 0;
      var unsub = EventBus.on(name, function () { count += 1; EventBus.emit(name, {}, { sourceModule: 'Core' }); });
      EventBus.emit(name, {}, { sourceModule: 'Core' });
      unsub(); EventBus.clear(name);
      return { pass: count <= MAX_EVENT_DEPTH + 1 && eventStats.blockedDepth >= 1, deliveredBeforeStop: count, maxDepth: MAX_EVENT_DEPTH };
    });

    /* E: duplicate settlement guard without advancing the real game. */
    check('test_E_duplicate_tick_guard', function () {
      var y = -999999, m = '__SelfTest', p = 'simulate';
      var key = [y, m, p].join('|'); delete Tick.runtime.completedSettlements[key];
      var a = Tick.markSettlement(m, p, y), b = Tick.markSettlement(m, p, y);
      delete Tick.runtime.completedSettlements[key];
      return { pass: a.ok && !b.ok && b.error.code === ERROR_CODES.DUPLICATE_TICK };
    });

    /* F: service exception is converted to INTERNAL_ERROR. */
    check('test_F_exception_isolation', function () {
      var svc = '__self.throw';
      if (Core.runtime.services[svc]) delete Core.runtime.services[svc];
      Core.registerService({ service: svc, module: 'Core', kind: 'query', handler: function () { throw new Error('test'); } });
      var r = Core.query(svc, {}); delete Core.runtime.services[svc];
      return { pass: !r.ok && r.error.code === ERROR_CODES.INTERNAL_ERROR };
    });

    /* G: query receives a cloned state context. */
    check('test_G_query_state_isolation', function () {
      var svc = '__self.queryIsolation';
      if (Core.runtime.services[svc]) delete Core.runtime.services[svc];
      var live = getGameState(); var before = stableStringify(live);
      Core.registerService({ service: svc, module: 'Core', kind: 'query', handler: function (_, ctx) { if (ctx.state && isObject(ctx.state)) ctx.state.__selfTestMutation = true; return true; } });
      var r = Core.query(svc, {}); delete Core.runtime.services[svc];
      var after = stableStringify(live);
      return { pass: r.ok && before === after };
    });

    /* H: adapter mechanism can invoke a legacy function and normalize it. */
    check('test_H_legacy_adapter_normalization', function () {
      var legacy = { ping: function () { return { pong: true }; } };
      var f = firstFunction(legacy, ['ping']);
      var r = normalizeResult(f.fn.call(legacy), 'Core');
      return { pass: r.ok && r.data && r.data.pong === true };
    });

    /* I: Research API namespace always exists; loaded Forge is reachable through it when present. */
    check('test_I_research_api_surface', function () {
      var surface = APIs.Research && isFunction(APIs.Research.query.getCapability) && isFunction(APIs.Research.command.startProject);
      var loaded = !!Core.adapters.Research._resolve();
      if (!loaded) warnings.push({ id: 'research_not_loaded', note: 'Research API surface is ready; current Module 10/Forge provider is not loaded.' });
      return { pass: !!surface, providerLoaded: loaded };
    }, true);

    /* J/K: authoritative service names are registered to M2/M3. */
    check('test_J_transport_route_service', function () {
      var s = Core.getService('transport.route');
      return { pass: !!s && s.module === 'Development' && s.kind === 'query', service: s ? { module: s.module, kind: s.kind } : null };
    });
    check('test_K_economy_treasury_service', function () {
      var s = Core.getService('economy.treasury');
      return { pass: !!s && s.module === 'Economy' && s.kind === 'query', service: s ? { module: s.module, kind: s.kind } : null };
    });

    /* L: ring buffer is bounded. */
    check('test_L_debug_ring_buffer_limit', function () {
      var rb = makeRingBuffer(5); for (var i = 0; i < 8; i += 1) rb.push(i);
      return { pass: rb.size() === 5 && rb.values()[0] === 3, size: rb.size(), max: rb.max };
    });

    check('state_ownership', function () { return Core.validateOwnership(); });
    check('dependency_validation', function () {
      var d = Core.validateDependencies();
      if (!d.ok) warnings.push({ id: 'dependency_warnings', warnings: d.warnings });
      return { pass: true, warnings: d.warnings };
    }, true);
    check('api_versions', function () {
      var bad = MODULE_ORDER.filter(function (id) { return !isString(APIs[id].API_VERSION); });
      return { pass: bad.length === 0, invalid: bad };
    });
    check('adapter_layer', function () {
      var missing = MODULE_ORDER.filter(function (id) { return !Core.adapters[id]; });
      return { pass: missing.length === 0, missing: missing };
    });
    check('tick_official_runner', function () {
      var pass = !!Tick._officialRunner || !Core.modules.Integration;
      if (!Tick._officialRunner) warnings.push({ id: 'no_official_tick_runner', note: 'Integration/Module 8 is not loaded, so Core correctly refuses to create a second annual flow.' });
      return { pass: pass, officialRunner: Tick._officialRunner ? Tick._officialRunner.module : null };
    }, true);

    var result = { ok: errors.length === 0, checks: checks, warnings: warnings, errors: errors };
    Core.runtime.lastSelfCheck = safeClone(result);
    return result;
  };

  /* ========================================================================
     17. Public Export / Bootstrap
     ======================================================================== */

  makeAdapters();
  buildServicesAndApis();

  /* Public surface: exactly one canonical family of globals. */
  BorderEpoch.Core = Core;
  BorderEpoch.API = APIs;
  BorderEpoch.Events = EventBus;
  BorderEpoch.Tick = Tick;

  /* Bootstrap is state-neutral: scan registrations only, never advance time or alter simulation state. */
  Core.registerExistingModules();

  if (global.document && isFunction(global.document.addEventListener)) {
    global.document.addEventListener('DOMContentLoaded', function () {
      Core.registerExistingModules();
    }, { once: true });
  }

})(typeof window !== 'undefined' ? window : globalThis);
