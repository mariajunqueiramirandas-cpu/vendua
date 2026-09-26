var Xp = Object.defineProperty;
var Zp = (e, t, n) =>
  t in e ? Xp(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : (e[t] = n);
var kn = (e, t, n) => Zp(e, typeof t != 'symbol' ? t + '' : t, n);
function eh(e, t) {
  for (var n = 0; n < t.length; n++) {
    const r = t[n];
    if (typeof r != 'string' && !Array.isArray(r)) {
      for (const l in r)
        if (l !== 'default' && !(l in e)) {
          const a = Object.getOwnPropertyDescriptor(r, l);
          a && Object.defineProperty(e, l, a.get ? a : { enumerable: !0, get: () => r[l] });
        }
    }
  }
  return Object.freeze(Object.defineProperty(e, Symbol.toStringTag, { value: 'Module' }));
}
(function () {
  const t = document.createElement('link').relList;
  if (t && t.supports && t.supports('modulepreload')) return;
  for (const l of document.querySelectorAll('link[rel="modulepreload"]')) r(l);
  new MutationObserver((l) => {
    for (const a of l)
      if (a.type === 'childList')
        for (const o of a.addedNodes) o.tagName === 'LINK' && o.rel === 'modulepreload' && r(o);
  }).observe(document, { childList: !0, subtree: !0 });
  function n(l) {
    const a = {};
    return (
      l.integrity && (a.integrity = l.integrity),
      l.referrerPolicy && (a.referrerPolicy = l.referrerPolicy),
      l.crossOrigin === 'use-credentials'
        ? (a.credentials = 'include')
        : l.crossOrigin === 'anonymous'
          ? (a.credentials = 'omit')
          : (a.credentials = 'same-origin'),
      a
    );
  }
  function r(l) {
    if (l.ep) return;
    l.ep = !0;
    const a = n(l);
    fetch(l.href, a);
  }
})();
function th(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, 'default') ? e.default : e;
}
var Mc = { exports: {} },
  Na = {},
  Oc = { exports: {} },
  A = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var rl = Symbol.for('react.element'),
  nh = Symbol.for('react.portal'),
  rh = Symbol.for('react.fragment'),
  lh = Symbol.for('react.strict_mode'),
  ah = Symbol.for('react.profiler'),
  oh = Symbol.for('react.provider'),
  ih = Symbol.for('react.context'),
  sh = Symbol.for('react.forward_ref'),
  uh = Symbol.for('react.suspense'),
  ch = Symbol.for('react.memo'),
  dh = Symbol.for('react.lazy'),
  ou = Symbol.iterator;
function fh(e) {
  return e === null || typeof e != 'object'
    ? null
    : ((e = (ou && e[ou]) || e['@@iterator']), typeof e == 'function' ? e : null);
}
var Ic = {
    isMounted: function () {
      return !1;
    },
    enqueueForceUpdate: function () {},
    enqueueReplaceState: function () {},
    enqueueSetState: function () {},
  },
  Ac = Object.assign,
  Dc = {};
function rr(e, t, n) {
  ((this.props = e), (this.context = t), (this.refs = Dc), (this.updater = n || Ic));
}
rr.prototype.isReactComponent = {};
rr.prototype.setState = function (e, t) {
  if (typeof e != 'object' && typeof e != 'function' && e != null)
    throw Error(
      'setState(...): takes an object of state variables to update or a function which returns an object of state variables.',
    );
  this.updater.enqueueSetState(this, e, t, 'setState');
};
rr.prototype.forceUpdate = function (e) {
  this.updater.enqueueForceUpdate(this, e, 'forceUpdate');
};
function zc() {}
zc.prototype = rr.prototype;
function Vi(e, t, n) {
  ((this.props = e), (this.context = t), (this.refs = Dc), (this.updater = n || Ic));
}
var Hi = (Vi.prototype = new zc());
Hi.constructor = Vi;
Ac(Hi, rr.prototype);
Hi.isPureReactComponent = !0;
var iu = Array.isArray,
  Bc = Object.prototype.hasOwnProperty,
  Wi = { current: null },
  Fc = { key: !0, ref: !0, __self: !0, __source: !0 };
function $c(e, t, n) {
  var r,
    l = {},
    a = null,
    o = null;
  if (t != null)
    for (r in (t.ref !== void 0 && (o = t.ref), t.key !== void 0 && (a = '' + t.key), t))
      Bc.call(t, r) && !Fc.hasOwnProperty(r) && (l[r] = t[r]);
  var s = arguments.length - 2;
  if (s === 1) l.children = n;
  else if (1 < s) {
    for (var u = Array(s), c = 0; c < s; c++) u[c] = arguments[c + 2];
    l.children = u;
  }
  if (e && e.defaultProps) for (r in ((s = e.defaultProps), s)) l[r] === void 0 && (l[r] = s[r]);
  return { $$typeof: rl, type: e, key: a, ref: o, props: l, _owner: Wi.current };
}
function ph(e, t) {
  return { $$typeof: rl, type: e.type, key: t, ref: e.ref, props: e.props, _owner: e._owner };
}
function Qi(e) {
  return typeof e == 'object' && e !== null && e.$$typeof === rl;
}
function hh(e) {
  var t = { '=': '=0', ':': '=2' };
  return (
    '$' +
    e.replace(/[=:]/g, function (n) {
      return t[n];
    })
  );
}
var su = /\/+/g;
function eo(e, t) {
  return typeof e == 'object' && e !== null && e.key != null ? hh('' + e.key) : t.toString(36);
}
function Dl(e, t, n, r, l) {
  var a = typeof e;
  (a === 'undefined' || a === 'boolean') && (e = null);
  var o = !1;
  if (e === null) o = !0;
  else
    switch (a) {
      case 'string':
      case 'number':
        o = !0;
        break;
      case 'object':
        switch (e.$$typeof) {
          case rl:
          case nh:
            o = !0;
        }
    }
  if (o)
    return (
      (o = e),
      (l = l(o)),
      (e = r === '' ? '.' + eo(o, 0) : r),
      iu(l)
        ? ((n = ''),
          e != null && (n = e.replace(su, '$&/') + '/'),
          Dl(l, t, n, '', function (c) {
            return c;
          }))
        : l != null &&
          (Qi(l) &&
            (l = ph(
              l,
              n +
                (!l.key || (o && o.key === l.key) ? '' : ('' + l.key).replace(su, '$&/') + '/') +
                e,
            )),
          t.push(l)),
      1
    );
  if (((o = 0), (r = r === '' ? '.' : r + ':'), iu(e)))
    for (var s = 0; s < e.length; s++) {
      a = e[s];
      var u = r + eo(a, s);
      o += Dl(a, t, n, u, l);
    }
  else if (((u = fh(e)), typeof u == 'function'))
    for (e = u.call(e), s = 0; !(a = e.next()).done;)
      ((a = a.value), (u = r + eo(a, s++)), (o += Dl(a, t, n, u, l)));
  else if (a === 'object')
    throw (
      (t = String(e)),
      Error(
        'Objects are not valid as a React child (found: ' +
          (t === '[object Object]' ? 'object with keys {' + Object.keys(e).join(', ') + '}' : t) +
          '). If you meant to render a collection of children, use an array instead.',
      )
    );
  return o;
}
function gl(e, t, n) {
  if (e == null) return e;
  var r = [],
    l = 0;
  return (
    Dl(e, r, '', '', function (a) {
      return t.call(n, a, l++);
    }),
    r
  );
}
function mh(e) {
  if (e._status === -1) {
    var t = e._result;
    ((t = t()),
      t.then(
        function (n) {
          (e._status === 0 || e._status === -1) && ((e._status = 1), (e._result = n));
        },
        function (n) {
          (e._status === 0 || e._status === -1) && ((e._status = 2), (e._result = n));
        },
      ),
      e._status === -1 && ((e._status = 0), (e._result = t)));
  }
  if (e._status === 1) return e._result.default;
  throw e._result;
}
var ke = { current: null },
  zl = { transition: null },
  gh = { ReactCurrentDispatcher: ke, ReactCurrentBatchConfig: zl, ReactCurrentOwner: Wi };
function Uc() {
  throw Error('act(...) is not supported in production builds of React.');
}
A.Children = {
  map: gl,
  forEach: function (e, t, n) {
    gl(
      e,
      function () {
        t.apply(this, arguments);
      },
      n,
    );
  },
  count: function (e) {
    var t = 0;
    return (
      gl(e, function () {
        t++;
      }),
      t
    );
  },
  toArray: function (e) {
    return (
      gl(e, function (t) {
        return t;
      }) || []
    );
  },
  only: function (e) {
    if (!Qi(e))
      throw Error('React.Children.only expected to receive a single React element child.');
    return e;
  },
};
A.Component = rr;
A.Fragment = rh;
A.Profiler = ah;
A.PureComponent = Vi;
A.StrictMode = lh;
A.Suspense = uh;
A.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = gh;
A.act = Uc;
A.cloneElement = function (e, t, n) {
  if (e == null)
    throw Error(
      'React.cloneElement(...): The argument must be a React element, but you passed ' + e + '.',
    );
  var r = Ac({}, e.props),
    l = e.key,
    a = e.ref,
    o = e._owner;
  if (t != null) {
    if (
      (t.ref !== void 0 && ((a = t.ref), (o = Wi.current)),
      t.key !== void 0 && (l = '' + t.key),
      e.type && e.type.defaultProps)
    )
      var s = e.type.defaultProps;
    for (u in t)
      Bc.call(t, u) &&
        !Fc.hasOwnProperty(u) &&
        (r[u] = t[u] === void 0 && s !== void 0 ? s[u] : t[u]);
  }
  var u = arguments.length - 2;
  if (u === 1) r.children = n;
  else if (1 < u) {
    s = Array(u);
    for (var c = 0; c < u; c++) s[c] = arguments[c + 2];
    r.children = s;
  }
  return { $$typeof: rl, type: e.type, key: l, ref: a, props: r, _owner: o };
};
A.createContext = function (e) {
  return (
    (e = {
      $$typeof: ih,
      _currentValue: e,
      _currentValue2: e,
      _threadCount: 0,
      Provider: null,
      Consumer: null,
      _defaultValue: null,
      _globalName: null,
    }),
    (e.Provider = { $$typeof: oh, _context: e }),
    (e.Consumer = e)
  );
};
A.createElement = $c;
A.createFactory = function (e) {
  var t = $c.bind(null, e);
  return ((t.type = e), t);
};
A.createRef = function () {
  return { current: null };
};
A.forwardRef = function (e) {
  return { $$typeof: sh, render: e };
};
A.isValidElement = Qi;
A.lazy = function (e) {
  return { $$typeof: dh, _payload: { _status: -1, _result: e }, _init: mh };
};
A.memo = function (e, t) {
  return { $$typeof: ch, type: e, compare: t === void 0 ? null : t };
};
A.startTransition = function (e) {
  var t = zl.transition;
  zl.transition = {};
  try {
    e();
  } finally {
    zl.transition = t;
  }
};
A.unstable_act = Uc;
A.useCallback = function (e, t) {
  return ke.current.useCallback(e, t);
};
A.useContext = function (e) {
  return ke.current.useContext(e);
};
A.useDebugValue = function () {};
A.useDeferredValue = function (e) {
  return ke.current.useDeferredValue(e);
};
A.useEffect = function (e, t) {
  return ke.current.useEffect(e, t);
};
A.useId = function () {
  return ke.current.useId();
};
A.useImperativeHandle = function (e, t, n) {
  return ke.current.useImperativeHandle(e, t, n);
};
A.useInsertionEffect = function (e, t) {
  return ke.current.useInsertionEffect(e, t);
};
A.useLayoutEffect = function (e, t) {
  return ke.current.useLayoutEffect(e, t);
};
A.useMemo = function (e, t) {
  return ke.current.useMemo(e, t);
};
A.useReducer = function (e, t, n) {
  return ke.current.useReducer(e, t, n);
};
A.useRef = function (e) {
  return ke.current.useRef(e);
};
A.useState = function (e) {
  return ke.current.useState(e);
};
A.useSyncExternalStore = function (e, t, n) {
  return ke.current.useSyncExternalStore(e, t, n);
};
A.useTransition = function () {
  return ke.current.useTransition();
};
A.version = '18.3.1';
Oc.exports = A;
var x = Oc.exports;
const vh = th(x),
  yh = eh({ __proto__: null, default: vh }, [x]);
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var xh = x,
  wh = Symbol.for('react.element'),
  kh = Symbol.for('react.fragment'),
  jh = Object.prototype.hasOwnProperty,
  Sh = xh.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,
  Nh = { key: !0, ref: !0, __self: !0, __source: !0 };
function Vc(e, t, n) {
  var r,
    l = {},
    a = null,
    o = null;
  (n !== void 0 && (a = '' + n),
    t.key !== void 0 && (a = '' + t.key),
    t.ref !== void 0 && (o = t.ref));
  for (r in t) jh.call(t, r) && !Nh.hasOwnProperty(r) && (l[r] = t[r]);
  if (e && e.defaultProps) for (r in ((t = e.defaultProps), t)) l[r] === void 0 && (l[r] = t[r]);
  return { $$typeof: wh, type: e, key: a, ref: o, props: l, _owner: Sh.current };
}
Na.Fragment = kh;
Na.jsx = Vc;
Na.jsxs = Vc;
Mc.exports = Na;
var i = Mc.exports,
  Hc = { exports: {} },
  Oe = {},
  Wc = { exports: {} },
  Qc = {};
/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ (function (e) {
  function t(L, M) {
    var O = L.length;
    L.push(M);
    e: for (; 0 < O;) {
      var $ = (O - 1) >>> 1,
        ee = L[$];
      if (0 < l(ee, M)) ((L[$] = M), (L[O] = ee), (O = $));
      else break e;
    }
  }
  function n(L) {
    return L.length === 0 ? null : L[0];
  }
  function r(L) {
    if (L.length === 0) return null;
    var M = L[0],
      O = L.pop();
    if (O !== M) {
      L[0] = O;
      e: for (var $ = 0, ee = L.length, Zt = ee >>> 1; $ < Zt;) {
        var mt = 2 * ($ + 1) - 1,
          cr = L[mt],
          De = mt + 1,
          wn = L[De];
        if (0 > l(cr, O))
          De < ee && 0 > l(wn, cr)
            ? ((L[$] = wn), (L[De] = O), ($ = De))
            : ((L[$] = cr), (L[mt] = O), ($ = mt));
        else if (De < ee && 0 > l(wn, O)) ((L[$] = wn), (L[De] = O), ($ = De));
        else break e;
      }
    }
    return M;
  }
  function l(L, M) {
    var O = L.sortIndex - M.sortIndex;
    return O !== 0 ? O : L.id - M.id;
  }
  if (typeof performance == 'object' && typeof performance.now == 'function') {
    var a = performance;
    e.unstable_now = function () {
      return a.now();
    };
  } else {
    var o = Date,
      s = o.now();
    e.unstable_now = function () {
      return o.now() - s;
    };
  }
  var u = [],
    c = [],
    m = 1,
    d = null,
    f = 3,
    v = !1,
    k = !1,
    w = !1,
    j = typeof setTimeout == 'function' ? setTimeout : null,
    h = typeof clearTimeout == 'function' ? clearTimeout : null,
    p = typeof setImmediate < 'u' ? setImmediate : null;
  typeof navigator < 'u' &&
    navigator.scheduling !== void 0 &&
    navigator.scheduling.isInputPending !== void 0 &&
    navigator.scheduling.isInputPending.bind(navigator.scheduling);
  function g(L) {
    for (var M = n(c); M !== null;) {
      if (M.callback === null) r(c);
      else if (M.startTime <= L) (r(c), (M.sortIndex = M.expirationTime), t(u, M));
      else break;
      M = n(c);
    }
  }
  function y(L) {
    if (((w = !1), g(L), !k))
      if (n(u) !== null) ((k = !0), ur(S));
      else {
        var M = n(c);
        M !== null && xn(y, M.startTime - L);
      }
  }
  function S(L, M) {
    ((k = !1), w && ((w = !1), h(P), (P = -1)), (v = !0));
    var O = f;
    try {
      for (g(M), d = n(u); d !== null && (!(d.expirationTime > M) || (L && !b()));) {
        var $ = d.callback;
        if (typeof $ == 'function') {
          ((d.callback = null), (f = d.priorityLevel));
          var ee = $(d.expirationTime <= M);
          ((M = e.unstable_now()),
            typeof ee == 'function' ? (d.callback = ee) : d === n(u) && r(u),
            g(M));
        } else r(u);
        d = n(u);
      }
      if (d !== null) var Zt = !0;
      else {
        var mt = n(c);
        (mt !== null && xn(y, mt.startTime - M), (Zt = !1));
      }
      return Zt;
    } finally {
      ((d = null), (f = O), (v = !1));
    }
  }
  var N = !1,
    _ = null,
    P = -1,
    I = 5,
    T = -1;
  function b() {
    return !(e.unstable_now() - T < I);
  }
  function re() {
    if (_ !== null) {
      var L = e.unstable_now();
      T = L;
      var M = !0;
      try {
        M = _(!0, L);
      } finally {
        M ? Z() : ((N = !1), (_ = null));
      }
    } else N = !1;
  }
  var Z;
  if (typeof p == 'function')
    Z = function () {
      p(re);
    };
  else if (typeof MessageChannel < 'u') {
    var sr = new MessageChannel(),
      ml = sr.port2;
    ((sr.port1.onmessage = re),
      (Z = function () {
        ml.postMessage(null);
      }));
  } else
    Z = function () {
      j(re, 0);
    };
  function ur(L) {
    ((_ = L), N || ((N = !0), Z()));
  }
  function xn(L, M) {
    P = j(function () {
      L(e.unstable_now());
    }, M);
  }
  ((e.unstable_IdlePriority = 5),
    (e.unstable_ImmediatePriority = 1),
    (e.unstable_LowPriority = 4),
    (e.unstable_NormalPriority = 3),
    (e.unstable_Profiling = null),
    (e.unstable_UserBlockingPriority = 2),
    (e.unstable_cancelCallback = function (L) {
      L.callback = null;
    }),
    (e.unstable_continueExecution = function () {
      k || v || ((k = !0), ur(S));
    }),
    (e.unstable_forceFrameRate = function (L) {
      0 > L || 125 < L
        ? console.error(
            'forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported',
          )
        : (I = 0 < L ? Math.floor(1e3 / L) : 5);
    }),
    (e.unstable_getCurrentPriorityLevel = function () {
      return f;
    }),
    (e.unstable_getFirstCallbackNode = function () {
      return n(u);
    }),
    (e.unstable_next = function (L) {
      switch (f) {
        case 1:
        case 2:
        case 3:
          var M = 3;
          break;
        default:
          M = f;
      }
      var O = f;
      f = M;
      try {
        return L();
      } finally {
        f = O;
      }
    }),
    (e.unstable_pauseExecution = function () {}),
    (e.unstable_requestPaint = function () {}),
    (e.unstable_runWithPriority = function (L, M) {
      switch (L) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          L = 3;
      }
      var O = f;
      f = L;
      try {
        return M();
      } finally {
        f = O;
      }
    }),
    (e.unstable_scheduleCallback = function (L, M, O) {
      var $ = e.unstable_now();
      switch (
        (typeof O == 'object' && O !== null
          ? ((O = O.delay), (O = typeof O == 'number' && 0 < O ? $ + O : $))
          : (O = $),
        L)
      ) {
        case 1:
          var ee = -1;
          break;
        case 2:
          ee = 250;
          break;
        case 5:
          ee = 1073741823;
          break;
        case 4:
          ee = 1e4;
          break;
        default:
          ee = 5e3;
      }
      return (
        (ee = O + ee),
        (L = {
          id: m++,
          callback: M,
          priorityLevel: L,
          startTime: O,
          expirationTime: ee,
          sortIndex: -1,
        }),
        O > $
          ? ((L.sortIndex = O),
            t(c, L),
            n(u) === null && L === n(c) && (w ? (h(P), (P = -1)) : (w = !0), xn(y, O - $)))
          : ((L.sortIndex = ee), t(u, L), k || v || ((k = !0), ur(S))),
        L
      );
    }),
    (e.unstable_shouldYield = b),
    (e.unstable_wrapCallback = function (L) {
      var M = f;
      return function () {
        var O = f;
        f = M;
        try {
          return L.apply(this, arguments);
        } finally {
          f = O;
        }
      };
    }));
})(Qc);
Wc.exports = Qc;
var Ch = Wc.exports;
/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var Eh = x,
  be = Ch;
function C(e) {
  for (
    var t = 'https://reactjs.org/docs/error-decoder.html?invariant=' + e, n = 1;
    n < arguments.length;
    n++
  )
    t += '&args[]=' + encodeURIComponent(arguments[n]);
  return (
    'Minified React error #' +
    e +
    '; visit ' +
    t +
    ' for the full message or use the non-minified dev environment for full errors and additional helpful warnings.'
  );
}
var Kc = new Set(),
  Or = {};
function mn(e, t) {
  (Vn(e, t), Vn(e + 'Capture', t));
}
function Vn(e, t) {
  for (Or[e] = t, e = 0; e < t.length; e++) Kc.add(t[e]);
}
var jt = !(
    typeof window > 'u' ||
    typeof window.document > 'u' ||
    typeof window.document.createElement > 'u'
  ),
  Io = Object.prototype.hasOwnProperty,
  _h =
    /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,
  uu = {},
  cu = {};
function Ph(e) {
  return Io.call(cu, e) ? !0 : Io.call(uu, e) ? !1 : _h.test(e) ? (cu[e] = !0) : ((uu[e] = !0), !1);
}
function Th(e, t, n, r) {
  if (n !== null && n.type === 0) return !1;
  switch (typeof t) {
    case 'function':
    case 'symbol':
      return !0;
    case 'boolean':
      return r
        ? !1
        : n !== null
          ? !n.acceptsBooleans
          : ((e = e.toLowerCase().slice(0, 5)), e !== 'data-' && e !== 'aria-');
    default:
      return !1;
  }
}
function Lh(e, t, n, r) {
  if (t === null || typeof t > 'u' || Th(e, t, n, r)) return !0;
  if (r) return !1;
  if (n !== null)
    switch (n.type) {
      case 3:
        return !t;
      case 4:
        return t === !1;
      case 5:
        return isNaN(t);
      case 6:
        return isNaN(t) || 1 > t;
    }
  return !1;
}
function je(e, t, n, r, l, a, o) {
  ((this.acceptsBooleans = t === 2 || t === 3 || t === 4),
    (this.attributeName = r),
    (this.attributeNamespace = l),
    (this.mustUseProperty = n),
    (this.propertyName = e),
    (this.type = t),
    (this.sanitizeURL = a),
    (this.removeEmptyString = o));
}
var fe = {};
'children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style'
  .split(' ')
  .forEach(function (e) {
    fe[e] = new je(e, 0, !1, e, null, !1, !1);
  });
[
  ['acceptCharset', 'accept-charset'],
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['httpEquiv', 'http-equiv'],
].forEach(function (e) {
  var t = e[0];
  fe[t] = new je(t, 1, !1, e[1], null, !1, !1);
});
['contentEditable', 'draggable', 'spellCheck', 'value'].forEach(function (e) {
  fe[e] = new je(e, 2, !1, e.toLowerCase(), null, !1, !1);
});
['autoReverse', 'externalResourcesRequired', 'focusable', 'preserveAlpha'].forEach(function (e) {
  fe[e] = new je(e, 2, !1, e, null, !1, !1);
});
'allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope'
  .split(' ')
  .forEach(function (e) {
    fe[e] = new je(e, 3, !1, e.toLowerCase(), null, !1, !1);
  });
['checked', 'multiple', 'muted', 'selected'].forEach(function (e) {
  fe[e] = new je(e, 3, !0, e, null, !1, !1);
});
['capture', 'download'].forEach(function (e) {
  fe[e] = new je(e, 4, !1, e, null, !1, !1);
});
['cols', 'rows', 'size', 'span'].forEach(function (e) {
  fe[e] = new je(e, 6, !1, e, null, !1, !1);
});
['rowSpan', 'start'].forEach(function (e) {
  fe[e] = new je(e, 5, !1, e.toLowerCase(), null, !1, !1);
});
var Ki = /[\-:]([a-z])/g;
function qi(e) {
  return e[1].toUpperCase();
}
'accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height'
  .split(' ')
  .forEach(function (e) {
    var t = e.replace(Ki, qi);
    fe[t] = new je(t, 1, !1, e, null, !1, !1);
  });
'xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type'
  .split(' ')
  .forEach(function (e) {
    var t = e.replace(Ki, qi);
    fe[t] = new je(t, 1, !1, e, 'http://www.w3.org/1999/xlink', !1, !1);
  });
['xml:base', 'xml:lang', 'xml:space'].forEach(function (e) {
  var t = e.replace(Ki, qi);
  fe[t] = new je(t, 1, !1, e, 'http://www.w3.org/XML/1998/namespace', !1, !1);
});
['tabIndex', 'crossOrigin'].forEach(function (e) {
  fe[e] = new je(e, 1, !1, e.toLowerCase(), null, !1, !1);
});
fe.xlinkHref = new je('xlinkHref', 1, !1, 'xlink:href', 'http://www.w3.org/1999/xlink', !0, !1);
['src', 'href', 'action', 'formAction'].forEach(function (e) {
  fe[e] = new je(e, 1, !1, e.toLowerCase(), null, !0, !0);
});
function Yi(e, t, n, r) {
  var l = fe.hasOwnProperty(t) ? fe[t] : null;
  (l !== null
    ? l.type !== 0
    : r || !(2 < t.length) || (t[0] !== 'o' && t[0] !== 'O') || (t[1] !== 'n' && t[1] !== 'N')) &&
    (Lh(t, n, l, r) && (n = null),
    r || l === null
      ? Ph(t) && (n === null ? e.removeAttribute(t) : e.setAttribute(t, '' + n))
      : l.mustUseProperty
        ? (e[l.propertyName] = n === null ? (l.type === 3 ? !1 : '') : n)
        : ((t = l.attributeName),
          (r = l.attributeNamespace),
          n === null
            ? e.removeAttribute(t)
            : ((l = l.type),
              (n = l === 3 || (l === 4 && n === !0) ? '' : '' + n),
              r ? e.setAttributeNS(r, t, n) : e.setAttribute(t, n))));
}
var Et = Eh.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  vl = Symbol.for('react.element'),
  Nn = Symbol.for('react.portal'),
  Cn = Symbol.for('react.fragment'),
  Ji = Symbol.for('react.strict_mode'),
  Ao = Symbol.for('react.profiler'),
  qc = Symbol.for('react.provider'),
  Yc = Symbol.for('react.context'),
  Gi = Symbol.for('react.forward_ref'),
  Do = Symbol.for('react.suspense'),
  zo = Symbol.for('react.suspense_list'),
  Xi = Symbol.for('react.memo'),
  Lt = Symbol.for('react.lazy'),
  Jc = Symbol.for('react.offscreen'),
  du = Symbol.iterator;
function dr(e) {
  return e === null || typeof e != 'object'
    ? null
    : ((e = (du && e[du]) || e['@@iterator']), typeof e == 'function' ? e : null);
}
var q = Object.assign,
  to;
function wr(e) {
  if (to === void 0)
    try {
      throw Error();
    } catch (n) {
      var t = n.stack.trim().match(/\n( *(at )?)/);
      to = (t && t[1]) || '';
    }
  return (
    `
` +
    to +
    e
  );
}
var no = !1;
function ro(e, t) {
  if (!e || no) return '';
  no = !0;
  var n = Error.prepareStackTrace;
  Error.prepareStackTrace = void 0;
  try {
    if (t)
      if (
        ((t = function () {
          throw Error();
        }),
        Object.defineProperty(t.prototype, 'props', {
          set: function () {
            throw Error();
          },
        }),
        typeof Reflect == 'object' && Reflect.construct)
      ) {
        try {
          Reflect.construct(t, []);
        } catch (c) {
          var r = c;
        }
        Reflect.construct(e, [], t);
      } else {
        try {
          t.call();
        } catch (c) {
          r = c;
        }
        e.call(t.prototype);
      }
    else {
      try {
        throw Error();
      } catch (c) {
        r = c;
      }
      e();
    }
  } catch (c) {
    if (c && r && typeof c.stack == 'string') {
      for (
        var l = c.stack.split(`
`),
          a = r.stack.split(`
`),
          o = l.length - 1,
          s = a.length - 1;
        1 <= o && 0 <= s && l[o] !== a[s];
      )
        s--;
      for (; 1 <= o && 0 <= s; o--, s--)
        if (l[o] !== a[s]) {
          if (o !== 1 || s !== 1)
            do
              if ((o--, s--, 0 > s || l[o] !== a[s])) {
                var u =
                  `
` + l[o].replace(' at new ', ' at ');
                return (
                  e.displayName &&
                    u.includes('<anonymous>') &&
                    (u = u.replace('<anonymous>', e.displayName)),
                  u
                );
              }
            while (1 <= o && 0 <= s);
          break;
        }
    }
  } finally {
    ((no = !1), (Error.prepareStackTrace = n));
  }
  return (e = e ? e.displayName || e.name : '') ? wr(e) : '';
}
function Rh(e) {
  switch (e.tag) {
    case 5:
      return wr(e.type);
    case 16:
      return wr('Lazy');
    case 13:
      return wr('Suspense');
    case 19:
      return wr('SuspenseList');
    case 0:
    case 2:
    case 15:
      return ((e = ro(e.type, !1)), e);
    case 11:
      return ((e = ro(e.type.render, !1)), e);
    case 1:
      return ((e = ro(e.type, !0)), e);
    default:
      return '';
  }
}
function Bo(e) {
  if (e == null) return null;
  if (typeof e == 'function') return e.displayName || e.name || null;
  if (typeof e == 'string') return e;
  switch (e) {
    case Cn:
      return 'Fragment';
    case Nn:
      return 'Portal';
    case Ao:
      return 'Profiler';
    case Ji:
      return 'StrictMode';
    case Do:
      return 'Suspense';
    case zo:
      return 'SuspenseList';
  }
  if (typeof e == 'object')
    switch (e.$$typeof) {
      case Yc:
        return (e.displayName || 'Context') + '.Consumer';
      case qc:
        return (e._context.displayName || 'Context') + '.Provider';
      case Gi:
        var t = e.render;
        return (
          (e = e.displayName),
          e ||
            ((e = t.displayName || t.name || ''),
            (e = e !== '' ? 'ForwardRef(' + e + ')' : 'ForwardRef')),
          e
        );
      case Xi:
        return ((t = e.displayName || null), t !== null ? t : Bo(e.type) || 'Memo');
      case Lt:
        ((t = e._payload), (e = e._init));
        try {
          return Bo(e(t));
        } catch {}
    }
  return null;
}
function bh(e) {
  var t = e.type;
  switch (e.tag) {
    case 24:
      return 'Cache';
    case 9:
      return (t.displayName || 'Context') + '.Consumer';
    case 10:
      return (t._context.displayName || 'Context') + '.Provider';
    case 18:
      return 'DehydratedFragment';
    case 11:
      return (
        (e = t.render),
        (e = e.displayName || e.name || ''),
        t.displayName || (e !== '' ? 'ForwardRef(' + e + ')' : 'ForwardRef')
      );
    case 7:
      return 'Fragment';
    case 5:
      return t;
    case 4:
      return 'Portal';
    case 3:
      return 'Root';
    case 6:
      return 'Text';
    case 16:
      return Bo(t);
    case 8:
      return t === Ji ? 'StrictMode' : 'Mode';
    case 22:
      return 'Offscreen';
    case 12:
      return 'Profiler';
    case 21:
      return 'Scope';
    case 13:
      return 'Suspense';
    case 19:
      return 'SuspenseList';
    case 25:
      return 'TracingMarker';
    case 1:
    case 0:
    case 17:
    case 2:
    case 14:
    case 15:
      if (typeof t == 'function') return t.displayName || t.name || null;
      if (typeof t == 'string') return t;
  }
  return null;
}
function Kt(e) {
  switch (typeof e) {
    case 'boolean':
    case 'number':
    case 'string':
    case 'undefined':
      return e;
    case 'object':
      return e;
    default:
      return '';
  }
}
function Gc(e) {
  var t = e.type;
  return (e = e.nodeName) && e.toLowerCase() === 'input' && (t === 'checkbox' || t === 'radio');
}
function Mh(e) {
  var t = Gc(e) ? 'checked' : 'value',
    n = Object.getOwnPropertyDescriptor(e.constructor.prototype, t),
    r = '' + e[t];
  if (
    !e.hasOwnProperty(t) &&
    typeof n < 'u' &&
    typeof n.get == 'function' &&
    typeof n.set == 'function'
  ) {
    var l = n.get,
      a = n.set;
    return (
      Object.defineProperty(e, t, {
        configurable: !0,
        get: function () {
          return l.call(this);
        },
        set: function (o) {
          ((r = '' + o), a.call(this, o));
        },
      }),
      Object.defineProperty(e, t, { enumerable: n.enumerable }),
      {
        getValue: function () {
          return r;
        },
        setValue: function (o) {
          r = '' + o;
        },
        stopTracking: function () {
          ((e._valueTracker = null), delete e[t]);
        },
      }
    );
  }
}
function yl(e) {
  e._valueTracker || (e._valueTracker = Mh(e));
}
function Xc(e) {
  if (!e) return !1;
  var t = e._valueTracker;
  if (!t) return !0;
  var n = t.getValue(),
    r = '';
  return (
    e && (r = Gc(e) ? (e.checked ? 'true' : 'false') : e.value),
    (e = r),
    e !== n ? (t.setValue(e), !0) : !1
  );
}
function Jl(e) {
  if (((e = e || (typeof document < 'u' ? document : void 0)), typeof e > 'u')) return null;
  try {
    return e.activeElement || e.body;
  } catch {
    return e.body;
  }
}
function Fo(e, t) {
  var n = t.checked;
  return q({}, t, {
    defaultChecked: void 0,
    defaultValue: void 0,
    value: void 0,
    checked: n ?? e._wrapperState.initialChecked,
  });
}
function fu(e, t) {
  var n = t.defaultValue == null ? '' : t.defaultValue,
    r = t.checked != null ? t.checked : t.defaultChecked;
  ((n = Kt(t.value != null ? t.value : n)),
    (e._wrapperState = {
      initialChecked: r,
      initialValue: n,
      controlled: t.type === 'checkbox' || t.type === 'radio' ? t.checked != null : t.value != null,
    }));
}
function Zc(e, t) {
  ((t = t.checked), t != null && Yi(e, 'checked', t, !1));
}
function $o(e, t) {
  Zc(e, t);
  var n = Kt(t.value),
    r = t.type;
  if (n != null)
    r === 'number'
      ? ((n === 0 && e.value === '') || e.value != n) && (e.value = '' + n)
      : e.value !== '' + n && (e.value = '' + n);
  else if (r === 'submit' || r === 'reset') {
    e.removeAttribute('value');
    return;
  }
  (t.hasOwnProperty('value')
    ? Uo(e, t.type, n)
    : t.hasOwnProperty('defaultValue') && Uo(e, t.type, Kt(t.defaultValue)),
    t.checked == null && t.defaultChecked != null && (e.defaultChecked = !!t.defaultChecked));
}
function pu(e, t, n) {
  if (t.hasOwnProperty('value') || t.hasOwnProperty('defaultValue')) {
    var r = t.type;
    if (!((r !== 'submit' && r !== 'reset') || (t.value !== void 0 && t.value !== null))) return;
    ((t = '' + e._wrapperState.initialValue),
      n || t === e.value || (e.value = t),
      (e.defaultValue = t));
  }
  ((n = e.name),
    n !== '' && (e.name = ''),
    (e.defaultChecked = !!e._wrapperState.initialChecked),
    n !== '' && (e.name = n));
}
function Uo(e, t, n) {
  (t !== 'number' || Jl(e.ownerDocument) !== e) &&
    (n == null
      ? (e.defaultValue = '' + e._wrapperState.initialValue)
      : e.defaultValue !== '' + n && (e.defaultValue = '' + n));
}
var kr = Array.isArray;
function An(e, t, n, r) {
  if (((e = e.options), t)) {
    t = {};
    for (var l = 0; l < n.length; l++) t['$' + n[l]] = !0;
    for (n = 0; n < e.length; n++)
      ((l = t.hasOwnProperty('$' + e[n].value)),
        e[n].selected !== l && (e[n].selected = l),
        l && r && (e[n].defaultSelected = !0));
  } else {
    for (n = '' + Kt(n), t = null, l = 0; l < e.length; l++) {
      if (e[l].value === n) {
        ((e[l].selected = !0), r && (e[l].defaultSelected = !0));
        return;
      }
      t !== null || e[l].disabled || (t = e[l]);
    }
    t !== null && (t.selected = !0);
  }
}
function Vo(e, t) {
  if (t.dangerouslySetInnerHTML != null) throw Error(C(91));
  return q({}, t, {
    value: void 0,
    defaultValue: void 0,
    children: '' + e._wrapperState.initialValue,
  });
}
function hu(e, t) {
  var n = t.value;
  if (n == null) {
    if (((n = t.children), (t = t.defaultValue), n != null)) {
      if (t != null) throw Error(C(92));
      if (kr(n)) {
        if (1 < n.length) throw Error(C(93));
        n = n[0];
      }
      t = n;
    }
    (t == null && (t = ''), (n = t));
  }
  e._wrapperState = { initialValue: Kt(n) };
}
function ed(e, t) {
  var n = Kt(t.value),
    r = Kt(t.defaultValue);
  (n != null &&
    ((n = '' + n),
    n !== e.value && (e.value = n),
    t.defaultValue == null && e.defaultValue !== n && (e.defaultValue = n)),
    r != null && (e.defaultValue = '' + r));
}
function mu(e) {
  var t = e.textContent;
  t === e._wrapperState.initialValue && t !== '' && t !== null && (e.value = t);
}
function td(e) {
  switch (e) {
    case 'svg':
      return 'http://www.w3.org/2000/svg';
    case 'math':
      return 'http://www.w3.org/1998/Math/MathML';
    default:
      return 'http://www.w3.org/1999/xhtml';
  }
}
function Ho(e, t) {
  return e == null || e === 'http://www.w3.org/1999/xhtml'
    ? td(t)
    : e === 'http://www.w3.org/2000/svg' && t === 'foreignObject'
      ? 'http://www.w3.org/1999/xhtml'
      : e;
}
var xl,
  nd = (function (e) {
    return typeof MSApp < 'u' && MSApp.execUnsafeLocalFunction
      ? function (t, n, r, l) {
          MSApp.execUnsafeLocalFunction(function () {
            return e(t, n, r, l);
          });
        }
      : e;
  })(function (e, t) {
    if (e.namespaceURI !== 'http://www.w3.org/2000/svg' || 'innerHTML' in e) e.innerHTML = t;
    else {
      for (
        xl = xl || document.createElement('div'),
          xl.innerHTML = '<svg>' + t.valueOf().toString() + '</svg>',
          t = xl.firstChild;
        e.firstChild;
      )
        e.removeChild(e.firstChild);
      for (; t.firstChild;) e.appendChild(t.firstChild);
    }
  });
function Ir(e, t) {
  if (t) {
    var n = e.firstChild;
    if (n && n === e.lastChild && n.nodeType === 3) {
      n.nodeValue = t;
      return;
    }
  }
  e.textContent = t;
}
var Nr = {
    animationIterationCount: !0,
    aspectRatio: !0,
    borderImageOutset: !0,
    borderImageSlice: !0,
    borderImageWidth: !0,
    boxFlex: !0,
    boxFlexGroup: !0,
    boxOrdinalGroup: !0,
    columnCount: !0,
    columns: !0,
    flex: !0,
    flexGrow: !0,
    flexPositive: !0,
    flexShrink: !0,
    flexNegative: !0,
    flexOrder: !0,
    gridArea: !0,
    gridRow: !0,
    gridRowEnd: !0,
    gridRowSpan: !0,
    gridRowStart: !0,
    gridColumn: !0,
    gridColumnEnd: !0,
    gridColumnSpan: !0,
    gridColumnStart: !0,
    fontWeight: !0,
    lineClamp: !0,
    lineHeight: !0,
    opacity: !0,
    order: !0,
    orphans: !0,
    tabSize: !0,
    widows: !0,
    zIndex: !0,
    zoom: !0,
    fillOpacity: !0,
    floodOpacity: !0,
    stopOpacity: !0,
    strokeDasharray: !0,
    strokeDashoffset: !0,
    strokeMiterlimit: !0,
    strokeOpacity: !0,
    strokeWidth: !0,
  },
  Oh = ['Webkit', 'ms', 'Moz', 'O'];
Object.keys(Nr).forEach(function (e) {
  Oh.forEach(function (t) {
    ((t = t + e.charAt(0).toUpperCase() + e.substring(1)), (Nr[t] = Nr[e]));
  });
});
function rd(e, t, n) {
  return t == null || typeof t == 'boolean' || t === ''
    ? ''
    : n || typeof t != 'number' || t === 0 || (Nr.hasOwnProperty(e) && Nr[e])
      ? ('' + t).trim()
      : t + 'px';
}
function ld(e, t) {
  e = e.style;
  for (var n in t)
    if (t.hasOwnProperty(n)) {
      var r = n.indexOf('--') === 0,
        l = rd(n, t[n], r);
      (n === 'float' && (n = 'cssFloat'), r ? e.setProperty(n, l) : (e[n] = l));
    }
}
var Ih = q(
  { menuitem: !0 },
  {
    area: !0,
    base: !0,
    br: !0,
    col: !0,
    embed: !0,
    hr: !0,
    img: !0,
    input: !0,
    keygen: !0,
    link: !0,
    meta: !0,
    param: !0,
    source: !0,
    track: !0,
    wbr: !0,
  },
);
function Wo(e, t) {
  if (t) {
    if (Ih[e] && (t.children != null || t.dangerouslySetInnerHTML != null)) throw Error(C(137, e));
    if (t.dangerouslySetInnerHTML != null) {
      if (t.children != null) throw Error(C(60));
      if (typeof t.dangerouslySetInnerHTML != 'object' || !('__html' in t.dangerouslySetInnerHTML))
        throw Error(C(61));
    }
    if (t.style != null && typeof t.style != 'object') throw Error(C(62));
  }
}
function Qo(e, t) {
  if (e.indexOf('-') === -1) return typeof t.is == 'string';
  switch (e) {
    case 'annotation-xml':
    case 'color-profile':
    case 'font-face':
    case 'font-face-src':
    case 'font-face-uri':
    case 'font-face-format':
    case 'font-face-name':
    case 'missing-glyph':
      return !1;
    default:
      return !0;
  }
}
var Ko = null;
function Zi(e) {
  return (
    (e = e.target || e.srcElement || window),
    e.correspondingUseElement && (e = e.correspondingUseElement),
    e.nodeType === 3 ? e.parentNode : e
  );
}
var qo = null,
  Dn = null,
  zn = null;
function gu(e) {
  if ((e = ol(e))) {
    if (typeof qo != 'function') throw Error(C(280));
    var t = e.stateNode;
    t && ((t = Ta(t)), qo(e.stateNode, e.type, t));
  }
}
function ad(e) {
  Dn ? (zn ? zn.push(e) : (zn = [e])) : (Dn = e);
}
function od() {
  if (Dn) {
    var e = Dn,
      t = zn;
    if (((zn = Dn = null), gu(e), t)) for (e = 0; e < t.length; e++) gu(t[e]);
  }
}
function id(e, t) {
  return e(t);
}
function sd() {}
var lo = !1;
function ud(e, t, n) {
  if (lo) return e(t, n);
  lo = !0;
  try {
    return id(e, t, n);
  } finally {
    ((lo = !1), (Dn !== null || zn !== null) && (sd(), od()));
  }
}
function Ar(e, t) {
  var n = e.stateNode;
  if (n === null) return null;
  var r = Ta(n);
  if (r === null) return null;
  n = r[t];
  e: switch (t) {
    case 'onClick':
    case 'onClickCapture':
    case 'onDoubleClick':
    case 'onDoubleClickCapture':
    case 'onMouseDown':
    case 'onMouseDownCapture':
    case 'onMouseMove':
    case 'onMouseMoveCapture':
    case 'onMouseUp':
    case 'onMouseUpCapture':
    case 'onMouseEnter':
      ((r = !r.disabled) ||
        ((e = e.type),
        (r = !(e === 'button' || e === 'input' || e === 'select' || e === 'textarea'))),
        (e = !r));
      break e;
    default:
      e = !1;
  }
  if (e) return null;
  if (n && typeof n != 'function') throw Error(C(231, t, typeof n));
  return n;
}
var Yo = !1;
if (jt)
  try {
    var fr = {};
    (Object.defineProperty(fr, 'passive', {
      get: function () {
        Yo = !0;
      },
    }),
      window.addEventListener('test', fr, fr),
      window.removeEventListener('test', fr, fr));
  } catch {
    Yo = !1;
  }
function Ah(e, t, n, r, l, a, o, s, u) {
  var c = Array.prototype.slice.call(arguments, 3);
  try {
    t.apply(n, c);
  } catch (m) {
    this.onError(m);
  }
}
var Cr = !1,
  Gl = null,
  Xl = !1,
  Jo = null,
  Dh = {
    onError: function (e) {
      ((Cr = !0), (Gl = e));
    },
  };
function zh(e, t, n, r, l, a, o, s, u) {
  ((Cr = !1), (Gl = null), Ah.apply(Dh, arguments));
}
function Bh(e, t, n, r, l, a, o, s, u) {
  if ((zh.apply(this, arguments), Cr)) {
    if (Cr) {
      var c = Gl;
      ((Cr = !1), (Gl = null));
    } else throw Error(C(198));
    Xl || ((Xl = !0), (Jo = c));
  }
}
function gn(e) {
  var t = e,
    n = e;
  if (e.alternate) for (; t.return;) t = t.return;
  else {
    e = t;
    do ((t = e), t.flags & 4098 && (n = t.return), (e = t.return));
    while (e);
  }
  return t.tag === 3 ? n : null;
}
function cd(e) {
  if (e.tag === 13) {
    var t = e.memoizedState;
    if ((t === null && ((e = e.alternate), e !== null && (t = e.memoizedState)), t !== null))
      return t.dehydrated;
  }
  return null;
}
function vu(e) {
  if (gn(e) !== e) throw Error(C(188));
}
function Fh(e) {
  var t = e.alternate;
  if (!t) {
    if (((t = gn(e)), t === null)) throw Error(C(188));
    return t !== e ? null : e;
  }
  for (var n = e, r = t; ;) {
    var l = n.return;
    if (l === null) break;
    var a = l.alternate;
    if (a === null) {
      if (((r = l.return), r !== null)) {
        n = r;
        continue;
      }
      break;
    }
    if (l.child === a.child) {
      for (a = l.child; a;) {
        if (a === n) return (vu(l), e);
        if (a === r) return (vu(l), t);
        a = a.sibling;
      }
      throw Error(C(188));
    }
    if (n.return !== r.return) ((n = l), (r = a));
    else {
      for (var o = !1, s = l.child; s;) {
        if (s === n) {
          ((o = !0), (n = l), (r = a));
          break;
        }
        if (s === r) {
          ((o = !0), (r = l), (n = a));
          break;
        }
        s = s.sibling;
      }
      if (!o) {
        for (s = a.child; s;) {
          if (s === n) {
            ((o = !0), (n = a), (r = l));
            break;
          }
          if (s === r) {
            ((o = !0), (r = a), (n = l));
            break;
          }
          s = s.sibling;
        }
        if (!o) throw Error(C(189));
      }
    }
    if (n.alternate !== r) throw Error(C(190));
  }
  if (n.tag !== 3) throw Error(C(188));
  return n.stateNode.current === n ? e : t;
}
function dd(e) {
  return ((e = Fh(e)), e !== null ? fd(e) : null);
}
function fd(e) {
  if (e.tag === 5 || e.tag === 6) return e;
  for (e = e.child; e !== null;) {
    var t = fd(e);
    if (t !== null) return t;
    e = e.sibling;
  }
  return null;
}
var pd = be.unstable_scheduleCallback,
  yu = be.unstable_cancelCallback,
  $h = be.unstable_shouldYield,
  Uh = be.unstable_requestPaint,
  G = be.unstable_now,
  Vh = be.unstable_getCurrentPriorityLevel,
  es = be.unstable_ImmediatePriority,
  hd = be.unstable_UserBlockingPriority,
  Zl = be.unstable_NormalPriority,
  Hh = be.unstable_LowPriority,
  md = be.unstable_IdlePriority,
  Ca = null,
  it = null;
function Wh(e) {
  if (it && typeof it.onCommitFiberRoot == 'function')
    try {
      it.onCommitFiberRoot(Ca, e, void 0, (e.current.flags & 128) === 128);
    } catch {}
}
var Ge = Math.clz32 ? Math.clz32 : qh,
  Qh = Math.log,
  Kh = Math.LN2;
function qh(e) {
  return ((e >>>= 0), e === 0 ? 32 : (31 - ((Qh(e) / Kh) | 0)) | 0);
}
var wl = 64,
  kl = 4194304;
function jr(e) {
  switch (e & -e) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 4:
      return 4;
    case 8:
      return 8;
    case 16:
      return 16;
    case 32:
      return 32;
    case 64:
    case 128:
    case 256:
    case 512:
    case 1024:
    case 2048:
    case 4096:
    case 8192:
    case 16384:
    case 32768:
    case 65536:
    case 131072:
    case 262144:
    case 524288:
    case 1048576:
    case 2097152:
      return e & 4194240;
    case 4194304:
    case 8388608:
    case 16777216:
    case 33554432:
    case 67108864:
      return e & 130023424;
    case 134217728:
      return 134217728;
    case 268435456:
      return 268435456;
    case 536870912:
      return 536870912;
    case 1073741824:
      return 1073741824;
    default:
      return e;
  }
}
function ea(e, t) {
  var n = e.pendingLanes;
  if (n === 0) return 0;
  var r = 0,
    l = e.suspendedLanes,
    a = e.pingedLanes,
    o = n & 268435455;
  if (o !== 0) {
    var s = o & ~l;
    s !== 0 ? (r = jr(s)) : ((a &= o), a !== 0 && (r = jr(a)));
  } else ((o = n & ~l), o !== 0 ? (r = jr(o)) : a !== 0 && (r = jr(a)));
  if (r === 0) return 0;
  if (
    t !== 0 &&
    t !== r &&
    !(t & l) &&
    ((l = r & -r), (a = t & -t), l >= a || (l === 16 && (a & 4194240) !== 0))
  )
    return t;
  if ((r & 4 && (r |= n & 16), (t = e.entangledLanes), t !== 0))
    for (e = e.entanglements, t &= r; 0 < t;)
      ((n = 31 - Ge(t)), (l = 1 << n), (r |= e[n]), (t &= ~l));
  return r;
}
function Yh(e, t) {
  switch (e) {
    case 1:
    case 2:
    case 4:
      return t + 250;
    case 8:
    case 16:
    case 32:
    case 64:
    case 128:
    case 256:
    case 512:
    case 1024:
    case 2048:
    case 4096:
    case 8192:
    case 16384:
    case 32768:
    case 65536:
    case 131072:
    case 262144:
    case 524288:
    case 1048576:
    case 2097152:
      return t + 5e3;
    case 4194304:
    case 8388608:
    case 16777216:
    case 33554432:
    case 67108864:
      return -1;
    case 134217728:
    case 268435456:
    case 536870912:
    case 1073741824:
      return -1;
    default:
      return -1;
  }
}
function Jh(e, t) {
  for (
    var n = e.suspendedLanes, r = e.pingedLanes, l = e.expirationTimes, a = e.pendingLanes;
    0 < a;
  ) {
    var o = 31 - Ge(a),
      s = 1 << o,
      u = l[o];
    (u === -1 ? (!(s & n) || s & r) && (l[o] = Yh(s, t)) : u <= t && (e.expiredLanes |= s),
      (a &= ~s));
  }
}
function Go(e) {
  return ((e = e.pendingLanes & -1073741825), e !== 0 ? e : e & 1073741824 ? 1073741824 : 0);
}
function gd() {
  var e = wl;
  return ((wl <<= 1), !(wl & 4194240) && (wl = 64), e);
}
function ao(e) {
  for (var t = [], n = 0; 31 > n; n++) t.push(e);
  return t;
}
function ll(e, t, n) {
  ((e.pendingLanes |= t),
    t !== 536870912 && ((e.suspendedLanes = 0), (e.pingedLanes = 0)),
    (e = e.eventTimes),
    (t = 31 - Ge(t)),
    (e[t] = n));
}
function Gh(e, t) {
  var n = e.pendingLanes & ~t;
  ((e.pendingLanes = t),
    (e.suspendedLanes = 0),
    (e.pingedLanes = 0),
    (e.expiredLanes &= t),
    (e.mutableReadLanes &= t),
    (e.entangledLanes &= t),
    (t = e.entanglements));
  var r = e.eventTimes;
  for (e = e.expirationTimes; 0 < n;) {
    var l = 31 - Ge(n),
      a = 1 << l;
    ((t[l] = 0), (r[l] = -1), (e[l] = -1), (n &= ~a));
  }
}
function ts(e, t) {
  var n = (e.entangledLanes |= t);
  for (e = e.entanglements; n;) {
    var r = 31 - Ge(n),
      l = 1 << r;
    ((l & t) | (e[r] & t) && (e[r] |= t), (n &= ~l));
  }
}
var z = 0;
function vd(e) {
  return ((e &= -e), 1 < e ? (4 < e ? (e & 268435455 ? 16 : 536870912) : 4) : 1);
}
var yd,
  ns,
  xd,
  wd,
  kd,
  Xo = !1,
  jl = [],
  zt = null,
  Bt = null,
  Ft = null,
  Dr = new Map(),
  zr = new Map(),
  bt = [],
  Xh =
    'mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit'.split(
      ' ',
    );
function xu(e, t) {
  switch (e) {
    case 'focusin':
    case 'focusout':
      zt = null;
      break;
    case 'dragenter':
    case 'dragleave':
      Bt = null;
      break;
    case 'mouseover':
    case 'mouseout':
      Ft = null;
      break;
    case 'pointerover':
    case 'pointerout':
      Dr.delete(t.pointerId);
      break;
    case 'gotpointercapture':
    case 'lostpointercapture':
      zr.delete(t.pointerId);
  }
}
function pr(e, t, n, r, l, a) {
  return e === null || e.nativeEvent !== a
    ? ((e = {
        blockedOn: t,
        domEventName: n,
        eventSystemFlags: r,
        nativeEvent: a,
        targetContainers: [l],
      }),
      t !== null && ((t = ol(t)), t !== null && ns(t)),
      e)
    : ((e.eventSystemFlags |= r),
      (t = e.targetContainers),
      l !== null && t.indexOf(l) === -1 && t.push(l),
      e);
}
function Zh(e, t, n, r, l) {
  switch (t) {
    case 'focusin':
      return ((zt = pr(zt, e, t, n, r, l)), !0);
    case 'dragenter':
      return ((Bt = pr(Bt, e, t, n, r, l)), !0);
    case 'mouseover':
      return ((Ft = pr(Ft, e, t, n, r, l)), !0);
    case 'pointerover':
      var a = l.pointerId;
      return (Dr.set(a, pr(Dr.get(a) || null, e, t, n, r, l)), !0);
    case 'gotpointercapture':
      return ((a = l.pointerId), zr.set(a, pr(zr.get(a) || null, e, t, n, r, l)), !0);
  }
  return !1;
}
function jd(e) {
  var t = rn(e.target);
  if (t !== null) {
    var n = gn(t);
    if (n !== null) {
      if (((t = n.tag), t === 13)) {
        if (((t = cd(n)), t !== null)) {
          ((e.blockedOn = t),
            kd(e.priority, function () {
              xd(n);
            }));
          return;
        }
      } else if (t === 3 && n.stateNode.current.memoizedState.isDehydrated) {
        e.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
        return;
      }
    }
  }
  e.blockedOn = null;
}
function Bl(e) {
  if (e.blockedOn !== null) return !1;
  for (var t = e.targetContainers; 0 < t.length;) {
    var n = Zo(e.domEventName, e.eventSystemFlags, t[0], e.nativeEvent);
    if (n === null) {
      n = e.nativeEvent;
      var r = new n.constructor(n.type, n);
      ((Ko = r), n.target.dispatchEvent(r), (Ko = null));
    } else return ((t = ol(n)), t !== null && ns(t), (e.blockedOn = n), !1);
    t.shift();
  }
  return !0;
}
function wu(e, t, n) {
  Bl(e) && n.delete(t);
}
function em() {
  ((Xo = !1),
    zt !== null && Bl(zt) && (zt = null),
    Bt !== null && Bl(Bt) && (Bt = null),
    Ft !== null && Bl(Ft) && (Ft = null),
    Dr.forEach(wu),
    zr.forEach(wu));
}
function hr(e, t) {
  e.blockedOn === t &&
    ((e.blockedOn = null),
    Xo || ((Xo = !0), be.unstable_scheduleCallback(be.unstable_NormalPriority, em)));
}
function Br(e) {
  function t(l) {
    return hr(l, e);
  }
  if (0 < jl.length) {
    hr(jl[0], e);
    for (var n = 1; n < jl.length; n++) {
      var r = jl[n];
      r.blockedOn === e && (r.blockedOn = null);
    }
  }
  for (
    zt !== null && hr(zt, e),
      Bt !== null && hr(Bt, e),
      Ft !== null && hr(Ft, e),
      Dr.forEach(t),
      zr.forEach(t),
      n = 0;
    n < bt.length;
    n++
  )
    ((r = bt[n]), r.blockedOn === e && (r.blockedOn = null));
  for (; 0 < bt.length && ((n = bt[0]), n.blockedOn === null);)
    (jd(n), n.blockedOn === null && bt.shift());
}
var Bn = Et.ReactCurrentBatchConfig,
  ta = !0;
function tm(e, t, n, r) {
  var l = z,
    a = Bn.transition;
  Bn.transition = null;
  try {
    ((z = 1), rs(e, t, n, r));
  } finally {
    ((z = l), (Bn.transition = a));
  }
}
function nm(e, t, n, r) {
  var l = z,
    a = Bn.transition;
  Bn.transition = null;
  try {
    ((z = 4), rs(e, t, n, r));
  } finally {
    ((z = l), (Bn.transition = a));
  }
}
function rs(e, t, n, r) {
  if (ta) {
    var l = Zo(e, t, n, r);
    if (l === null) (go(e, t, r, na, n), xu(e, r));
    else if (Zh(l, e, t, n, r)) r.stopPropagation();
    else if ((xu(e, r), t & 4 && -1 < Xh.indexOf(e))) {
      for (; l !== null;) {
        var a = ol(l);
        if ((a !== null && yd(a), (a = Zo(e, t, n, r)), a === null && go(e, t, r, na, n), a === l))
          break;
        l = a;
      }
      l !== null && r.stopPropagation();
    } else go(e, t, r, null, n);
  }
}
var na = null;
function Zo(e, t, n, r) {
  if (((na = null), (e = Zi(r)), (e = rn(e)), e !== null))
    if (((t = gn(e)), t === null)) e = null;
    else if (((n = t.tag), n === 13)) {
      if (((e = cd(t)), e !== null)) return e;
      e = null;
    } else if (n === 3) {
      if (t.stateNode.current.memoizedState.isDehydrated)
        return t.tag === 3 ? t.stateNode.containerInfo : null;
      e = null;
    } else t !== e && (e = null);
  return ((na = e), null);
}
function Sd(e) {
  switch (e) {
    case 'cancel':
    case 'click':
    case 'close':
    case 'contextmenu':
    case 'copy':
    case 'cut':
    case 'auxclick':
    case 'dblclick':
    case 'dragend':
    case 'dragstart':
    case 'drop':
    case 'focusin':
    case 'focusout':
    case 'input':
    case 'invalid':
    case 'keydown':
    case 'keypress':
    case 'keyup':
    case 'mousedown':
    case 'mouseup':
    case 'paste':
    case 'pause':
    case 'play':
    case 'pointercancel':
    case 'pointerdown':
    case 'pointerup':
    case 'ratechange':
    case 'reset':
    case 'resize':
    case 'seeked':
    case 'submit':
    case 'touchcancel':
    case 'touchend':
    case 'touchstart':
    case 'volumechange':
    case 'change':
    case 'selectionchange':
    case 'textInput':
    case 'compositionstart':
    case 'compositionend':
    case 'compositionupdate':
    case 'beforeblur':
    case 'afterblur':
    case 'beforeinput':
    case 'blur':
    case 'fullscreenchange':
    case 'focus':
    case 'hashchange':
    case 'popstate':
    case 'select':
    case 'selectstart':
      return 1;
    case 'drag':
    case 'dragenter':
    case 'dragexit':
    case 'dragleave':
    case 'dragover':
    case 'mousemove':
    case 'mouseout':
    case 'mouseover':
    case 'pointermove':
    case 'pointerout':
    case 'pointerover':
    case 'scroll':
    case 'toggle':
    case 'touchmove':
    case 'wheel':
    case 'mouseenter':
    case 'mouseleave':
    case 'pointerenter':
    case 'pointerleave':
      return 4;
    case 'message':
      switch (Vh()) {
        case es:
          return 1;
        case hd:
          return 4;
        case Zl:
        case Hh:
          return 16;
        case md:
          return 536870912;
        default:
          return 16;
      }
    default:
      return 16;
  }
}
var Ot = null,
  ls = null,
  Fl = null;
function Nd() {
  if (Fl) return Fl;
  var e,
    t = ls,
    n = t.length,
    r,
    l = 'value' in Ot ? Ot.value : Ot.textContent,
    a = l.length;
  for (e = 0; e < n && t[e] === l[e]; e++);
  var o = n - e;
  for (r = 1; r <= o && t[n - r] === l[a - r]; r++);
  return (Fl = l.slice(e, 1 < r ? 1 - r : void 0));
}
function $l(e) {
  var t = e.keyCode;
  return (
    'charCode' in e ? ((e = e.charCode), e === 0 && t === 13 && (e = 13)) : (e = t),
    e === 10 && (e = 13),
    32 <= e || e === 13 ? e : 0
  );
}
function Sl() {
  return !0;
}
function ku() {
  return !1;
}
function Ie(e) {
  function t(n, r, l, a, o) {
    ((this._reactName = n),
      (this._targetInst = l),
      (this.type = r),
      (this.nativeEvent = a),
      (this.target = o),
      (this.currentTarget = null));
    for (var s in e) e.hasOwnProperty(s) && ((n = e[s]), (this[s] = n ? n(a) : a[s]));
    return (
      (this.isDefaultPrevented = (
        a.defaultPrevented != null ? a.defaultPrevented : a.returnValue === !1
      )
        ? Sl
        : ku),
      (this.isPropagationStopped = ku),
      this
    );
  }
  return (
    q(t.prototype, {
      preventDefault: function () {
        this.defaultPrevented = !0;
        var n = this.nativeEvent;
        n &&
          (n.preventDefault
            ? n.preventDefault()
            : typeof n.returnValue != 'unknown' && (n.returnValue = !1),
          (this.isDefaultPrevented = Sl));
      },
      stopPropagation: function () {
        var n = this.nativeEvent;
        n &&
          (n.stopPropagation
            ? n.stopPropagation()
            : typeof n.cancelBubble != 'unknown' && (n.cancelBubble = !0),
          (this.isPropagationStopped = Sl));
      },
      persist: function () {},
      isPersistent: Sl,
    }),
    t
  );
}
var lr = {
    eventPhase: 0,
    bubbles: 0,
    cancelable: 0,
    timeStamp: function (e) {
      return e.timeStamp || Date.now();
    },
    defaultPrevented: 0,
    isTrusted: 0,
  },
  as = Ie(lr),
  al = q({}, lr, { view: 0, detail: 0 }),
  rm = Ie(al),
  oo,
  io,
  mr,
  Ea = q({}, al, {
    screenX: 0,
    screenY: 0,
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    getModifierState: os,
    button: 0,
    buttons: 0,
    relatedTarget: function (e) {
      return e.relatedTarget === void 0
        ? e.fromElement === e.srcElement
          ? e.toElement
          : e.fromElement
        : e.relatedTarget;
    },
    movementX: function (e) {
      return 'movementX' in e
        ? e.movementX
        : (e !== mr &&
            (mr && e.type === 'mousemove'
              ? ((oo = e.screenX - mr.screenX), (io = e.screenY - mr.screenY))
              : (io = oo = 0),
            (mr = e)),
          oo);
    },
    movementY: function (e) {
      return 'movementY' in e ? e.movementY : io;
    },
  }),
  ju = Ie(Ea),
  lm = q({}, Ea, { dataTransfer: 0 }),
  am = Ie(lm),
  om = q({}, al, { relatedTarget: 0 }),
  so = Ie(om),
  im = q({}, lr, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
  sm = Ie(im),
  um = q({}, lr, {
    clipboardData: function (e) {
      return 'clipboardData' in e ? e.clipboardData : window.clipboardData;
    },
  }),
  cm = Ie(um),
  dm = q({}, lr, { data: 0 }),
  Su = Ie(dm),
  fm = {
    Esc: 'Escape',
    Spacebar: ' ',
    Left: 'ArrowLeft',
    Up: 'ArrowUp',
    Right: 'ArrowRight',
    Down: 'ArrowDown',
    Del: 'Delete',
    Win: 'OS',
    Menu: 'ContextMenu',
    Apps: 'ContextMenu',
    Scroll: 'ScrollLock',
    MozPrintableKey: 'Unidentified',
  },
  pm = {
    8: 'Backspace',
    9: 'Tab',
    12: 'Clear',
    13: 'Enter',
    16: 'Shift',
    17: 'Control',
    18: 'Alt',
    19: 'Pause',
    20: 'CapsLock',
    27: 'Escape',
    32: ' ',
    33: 'PageUp',
    34: 'PageDown',
    35: 'End',
    36: 'Home',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
    45: 'Insert',
    46: 'Delete',
    112: 'F1',
    113: 'F2',
    114: 'F3',
    115: 'F4',
    116: 'F5',
    117: 'F6',
    118: 'F7',
    119: 'F8',
    120: 'F9',
    121: 'F10',
    122: 'F11',
    123: 'F12',
    144: 'NumLock',
    145: 'ScrollLock',
    224: 'Meta',
  },
  hm = { Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey', Shift: 'shiftKey' };
function mm(e) {
  var t = this.nativeEvent;
  return t.getModifierState ? t.getModifierState(e) : (e = hm[e]) ? !!t[e] : !1;
}
function os() {
  return mm;
}
var gm = q({}, al, {
    key: function (e) {
      if (e.key) {
        var t = fm[e.key] || e.key;
        if (t !== 'Unidentified') return t;
      }
      return e.type === 'keypress'
        ? ((e = $l(e)), e === 13 ? 'Enter' : String.fromCharCode(e))
        : e.type === 'keydown' || e.type === 'keyup'
          ? pm[e.keyCode] || 'Unidentified'
          : '';
    },
    code: 0,
    location: 0,
    ctrlKey: 0,
    shiftKey: 0,
    altKey: 0,
    metaKey: 0,
    repeat: 0,
    locale: 0,
    getModifierState: os,
    charCode: function (e) {
      return e.type === 'keypress' ? $l(e) : 0;
    },
    keyCode: function (e) {
      return e.type === 'keydown' || e.type === 'keyup' ? e.keyCode : 0;
    },
    which: function (e) {
      return e.type === 'keypress'
        ? $l(e)
        : e.type === 'keydown' || e.type === 'keyup'
          ? e.keyCode
          : 0;
    },
  }),
  vm = Ie(gm),
  ym = q({}, Ea, {
    pointerId: 0,
    width: 0,
    height: 0,
    pressure: 0,
    tangentialPressure: 0,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: 0,
    isPrimary: 0,
  }),
  Nu = Ie(ym),
  xm = q({}, al, {
    touches: 0,
    targetTouches: 0,
    changedTouches: 0,
    altKey: 0,
    metaKey: 0,
    ctrlKey: 0,
    shiftKey: 0,
    getModifierState: os,
  }),
  wm = Ie(xm),
  km = q({}, lr, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
  jm = Ie(km),
  Sm = q({}, Ea, {
    deltaX: function (e) {
      return 'deltaX' in e ? e.deltaX : 'wheelDeltaX' in e ? -e.wheelDeltaX : 0;
    },
    deltaY: function (e) {
      return 'deltaY' in e
        ? e.deltaY
        : 'wheelDeltaY' in e
          ? -e.wheelDeltaY
          : 'wheelDelta' in e
            ? -e.wheelDelta
            : 0;
    },
    deltaZ: 0,
    deltaMode: 0,
  }),
  Nm = Ie(Sm),
  Cm = [9, 13, 27, 32],
  is = jt && 'CompositionEvent' in window,
  Er = null;
jt && 'documentMode' in document && (Er = document.documentMode);
var Em = jt && 'TextEvent' in window && !Er,
  Cd = jt && (!is || (Er && 8 < Er && 11 >= Er)),
  Cu = ' ',
  Eu = !1;
function Ed(e, t) {
  switch (e) {
    case 'keyup':
      return Cm.indexOf(t.keyCode) !== -1;
    case 'keydown':
      return t.keyCode !== 229;
    case 'keypress':
    case 'mousedown':
    case 'focusout':
      return !0;
    default:
      return !1;
  }
}
function _d(e) {
  return ((e = e.detail), typeof e == 'object' && 'data' in e ? e.data : null);
}
var En = !1;
function _m(e, t) {
  switch (e) {
    case 'compositionend':
      return _d(t);
    case 'keypress':
      return t.which !== 32 ? null : ((Eu = !0), Cu);
    case 'textInput':
      return ((e = t.data), e === Cu && Eu ? null : e);
    default:
      return null;
  }
}
function Pm(e, t) {
  if (En)
    return e === 'compositionend' || (!is && Ed(e, t))
      ? ((e = Nd()), (Fl = ls = Ot = null), (En = !1), e)
      : null;
  switch (e) {
    case 'paste':
      return null;
    case 'keypress':
      if (!(t.ctrlKey || t.altKey || t.metaKey) || (t.ctrlKey && t.altKey)) {
        if (t.char && 1 < t.char.length) return t.char;
        if (t.which) return String.fromCharCode(t.which);
      }
      return null;
    case 'compositionend':
      return Cd && t.locale !== 'ko' ? null : t.data;
    default:
      return null;
  }
}
var Tm = {
  color: !0,
  date: !0,
  datetime: !0,
  'datetime-local': !0,
  email: !0,
  month: !0,
  number: !0,
  password: !0,
  range: !0,
  search: !0,
  tel: !0,
  text: !0,
  time: !0,
  url: !0,
  week: !0,
};
function _u(e) {
  var t = e && e.nodeName && e.nodeName.toLowerCase();
  return t === 'input' ? !!Tm[e.type] : t === 'textarea';
}
function Pd(e, t, n, r) {
  (ad(r),
    (t = ra(t, 'onChange')),
    0 < t.length &&
      ((n = new as('onChange', 'change', null, n, r)), e.push({ event: n, listeners: t })));
}
var _r = null,
  Fr = null;
function Lm(e) {
  Bd(e, 0);
}
function _a(e) {
  var t = Tn(e);
  if (Xc(t)) return e;
}
function Rm(e, t) {
  if (e === 'change') return t;
}
var Td = !1;
if (jt) {
  var uo;
  if (jt) {
    var co = 'oninput' in document;
    if (!co) {
      var Pu = document.createElement('div');
      (Pu.setAttribute('oninput', 'return;'), (co = typeof Pu.oninput == 'function'));
    }
    uo = co;
  } else uo = !1;
  Td = uo && (!document.documentMode || 9 < document.documentMode);
}
function Tu() {
  _r && (_r.detachEvent('onpropertychange', Ld), (Fr = _r = null));
}
function Ld(e) {
  if (e.propertyName === 'value' && _a(Fr)) {
    var t = [];
    (Pd(t, Fr, e, Zi(e)), ud(Lm, t));
  }
}
function bm(e, t, n) {
  e === 'focusin'
    ? (Tu(), (_r = t), (Fr = n), _r.attachEvent('onpropertychange', Ld))
    : e === 'focusout' && Tu();
}
function Mm(e) {
  if (e === 'selectionchange' || e === 'keyup' || e === 'keydown') return _a(Fr);
}
function Om(e, t) {
  if (e === 'click') return _a(t);
}
function Im(e, t) {
  if (e === 'input' || e === 'change') return _a(t);
}
function Am(e, t) {
  return (e === t && (e !== 0 || 1 / e === 1 / t)) || (e !== e && t !== t);
}
var Ze = typeof Object.is == 'function' ? Object.is : Am;
function $r(e, t) {
  if (Ze(e, t)) return !0;
  if (typeof e != 'object' || e === null || typeof t != 'object' || t === null) return !1;
  var n = Object.keys(e),
    r = Object.keys(t);
  if (n.length !== r.length) return !1;
  for (r = 0; r < n.length; r++) {
    var l = n[r];
    if (!Io.call(t, l) || !Ze(e[l], t[l])) return !1;
  }
  return !0;
}
function Lu(e) {
  for (; e && e.firstChild;) e = e.firstChild;
  return e;
}
function Ru(e, t) {
  var n = Lu(e);
  e = 0;
  for (var r; n;) {
    if (n.nodeType === 3) {
      if (((r = e + n.textContent.length), e <= t && r >= t)) return { node: n, offset: t - e };
      e = r;
    }
    e: {
      for (; n;) {
        if (n.nextSibling) {
          n = n.nextSibling;
          break e;
        }
        n = n.parentNode;
      }
      n = void 0;
    }
    n = Lu(n);
  }
}
function Rd(e, t) {
  return e && t
    ? e === t
      ? !0
      : e && e.nodeType === 3
        ? !1
        : t && t.nodeType === 3
          ? Rd(e, t.parentNode)
          : 'contains' in e
            ? e.contains(t)
            : e.compareDocumentPosition
              ? !!(e.compareDocumentPosition(t) & 16)
              : !1
    : !1;
}
function bd() {
  for (var e = window, t = Jl(); t instanceof e.HTMLIFrameElement;) {
    try {
      var n = typeof t.contentWindow.location.href == 'string';
    } catch {
      n = !1;
    }
    if (n) e = t.contentWindow;
    else break;
    t = Jl(e.document);
  }
  return t;
}
function ss(e) {
  var t = e && e.nodeName && e.nodeName.toLowerCase();
  return (
    t &&
    ((t === 'input' &&
      (e.type === 'text' ||
        e.type === 'search' ||
        e.type === 'tel' ||
        e.type === 'url' ||
        e.type === 'password')) ||
      t === 'textarea' ||
      e.contentEditable === 'true')
  );
}
function Dm(e) {
  var t = bd(),
    n = e.focusedElem,
    r = e.selectionRange;
  if (t !== n && n && n.ownerDocument && Rd(n.ownerDocument.documentElement, n)) {
    if (r !== null && ss(n)) {
      if (((t = r.start), (e = r.end), e === void 0 && (e = t), 'selectionStart' in n))
        ((n.selectionStart = t), (n.selectionEnd = Math.min(e, n.value.length)));
      else if (
        ((e = ((t = n.ownerDocument || document) && t.defaultView) || window), e.getSelection)
      ) {
        e = e.getSelection();
        var l = n.textContent.length,
          a = Math.min(r.start, l);
        ((r = r.end === void 0 ? a : Math.min(r.end, l)),
          !e.extend && a > r && ((l = r), (r = a), (a = l)),
          (l = Ru(n, a)));
        var o = Ru(n, r);
        l &&
          o &&
          (e.rangeCount !== 1 ||
            e.anchorNode !== l.node ||
            e.anchorOffset !== l.offset ||
            e.focusNode !== o.node ||
            e.focusOffset !== o.offset) &&
          ((t = t.createRange()),
          t.setStart(l.node, l.offset),
          e.removeAllRanges(),
          a > r
            ? (e.addRange(t), e.extend(o.node, o.offset))
            : (t.setEnd(o.node, o.offset), e.addRange(t)));
      }
    }
    for (t = [], e = n; (e = e.parentNode);)
      e.nodeType === 1 && t.push({ element: e, left: e.scrollLeft, top: e.scrollTop });
    for (typeof n.focus == 'function' && n.focus(), n = 0; n < t.length; n++)
      ((e = t[n]), (e.element.scrollLeft = e.left), (e.element.scrollTop = e.top));
  }
}
var zm = jt && 'documentMode' in document && 11 >= document.documentMode,
  _n = null,
  ei = null,
  Pr = null,
  ti = !1;
function bu(e, t, n) {
  var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
  ti ||
    _n == null ||
    _n !== Jl(r) ||
    ((r = _n),
    'selectionStart' in r && ss(r)
      ? (r = { start: r.selectionStart, end: r.selectionEnd })
      : ((r = ((r.ownerDocument && r.ownerDocument.defaultView) || window).getSelection()),
        (r = {
          anchorNode: r.anchorNode,
          anchorOffset: r.anchorOffset,
          focusNode: r.focusNode,
          focusOffset: r.focusOffset,
        })),
    (Pr && $r(Pr, r)) ||
      ((Pr = r),
      (r = ra(ei, 'onSelect')),
      0 < r.length &&
        ((t = new as('onSelect', 'select', null, t, n)),
        e.push({ event: t, listeners: r }),
        (t.target = _n))));
}
function Nl(e, t) {
  var n = {};
  return (
    (n[e.toLowerCase()] = t.toLowerCase()),
    (n['Webkit' + e] = 'webkit' + t),
    (n['Moz' + e] = 'moz' + t),
    n
  );
}
var Pn = {
    animationend: Nl('Animation', 'AnimationEnd'),
    animationiteration: Nl('Animation', 'AnimationIteration'),
    animationstart: Nl('Animation', 'AnimationStart'),
    transitionend: Nl('Transition', 'TransitionEnd'),
  },
  fo = {},
  Md = {};
jt &&
  ((Md = document.createElement('div').style),
  'AnimationEvent' in window ||
    (delete Pn.animationend.animation,
    delete Pn.animationiteration.animation,
    delete Pn.animationstart.animation),
  'TransitionEvent' in window || delete Pn.transitionend.transition);
function Pa(e) {
  if (fo[e]) return fo[e];
  if (!Pn[e]) return e;
  var t = Pn[e],
    n;
  for (n in t) if (t.hasOwnProperty(n) && n in Md) return (fo[e] = t[n]);
  return e;
}
var Od = Pa('animationend'),
  Id = Pa('animationiteration'),
  Ad = Pa('animationstart'),
  Dd = Pa('transitionend'),
  zd = new Map(),
  Mu =
    'abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel'.split(
      ' ',
    );
function Yt(e, t) {
  (zd.set(e, t), mn(t, [e]));
}
for (var po = 0; po < Mu.length; po++) {
  var ho = Mu[po],
    Bm = ho.toLowerCase(),
    Fm = ho[0].toUpperCase() + ho.slice(1);
  Yt(Bm, 'on' + Fm);
}
Yt(Od, 'onAnimationEnd');
Yt(Id, 'onAnimationIteration');
Yt(Ad, 'onAnimationStart');
Yt('dblclick', 'onDoubleClick');
Yt('focusin', 'onFocus');
Yt('focusout', 'onBlur');
Yt(Dd, 'onTransitionEnd');
Vn('onMouseEnter', ['mouseout', 'mouseover']);
Vn('onMouseLeave', ['mouseout', 'mouseover']);
Vn('onPointerEnter', ['pointerout', 'pointerover']);
Vn('onPointerLeave', ['pointerout', 'pointerover']);
mn('onChange', 'change click focusin focusout input keydown keyup selectionchange'.split(' '));
mn(
  'onSelect',
  'focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange'.split(' '),
);
mn('onBeforeInput', ['compositionend', 'keypress', 'textInput', 'paste']);
mn('onCompositionEnd', 'compositionend focusout keydown keypress keyup mousedown'.split(' '));
mn('onCompositionStart', 'compositionstart focusout keydown keypress keyup mousedown'.split(' '));
mn('onCompositionUpdate', 'compositionupdate focusout keydown keypress keyup mousedown'.split(' '));
var Sr =
    'abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting'.split(
      ' ',
    ),
  $m = new Set('cancel close invalid load scroll toggle'.split(' ').concat(Sr));
function Ou(e, t, n) {
  var r = e.type || 'unknown-event';
  ((e.currentTarget = n), Bh(r, t, void 0, e), (e.currentTarget = null));
}
function Bd(e, t) {
  t = (t & 4) !== 0;
  for (var n = 0; n < e.length; n++) {
    var r = e[n],
      l = r.event;
    r = r.listeners;
    e: {
      var a = void 0;
      if (t)
        for (var o = r.length - 1; 0 <= o; o--) {
          var s = r[o],
            u = s.instance,
            c = s.currentTarget;
          if (((s = s.listener), u !== a && l.isPropagationStopped())) break e;
          (Ou(l, s, c), (a = u));
        }
      else
        for (o = 0; o < r.length; o++) {
          if (
            ((s = r[o]),
            (u = s.instance),
            (c = s.currentTarget),
            (s = s.listener),
            u !== a && l.isPropagationStopped())
          )
            break e;
          (Ou(l, s, c), (a = u));
        }
    }
  }
  if (Xl) throw ((e = Jo), (Xl = !1), (Jo = null), e);
}
function U(e, t) {
  var n = t[oi];
  n === void 0 && (n = t[oi] = new Set());
  var r = e + '__bubble';
  n.has(r) || (Fd(t, e, 2, !1), n.add(r));
}
function mo(e, t, n) {
  var r = 0;
  (t && (r |= 4), Fd(n, e, r, t));
}
var Cl = '_reactListening' + Math.random().toString(36).slice(2);
function Ur(e) {
  if (!e[Cl]) {
    ((e[Cl] = !0),
      Kc.forEach(function (n) {
        n !== 'selectionchange' && ($m.has(n) || mo(n, !1, e), mo(n, !0, e));
      }));
    var t = e.nodeType === 9 ? e : e.ownerDocument;
    t === null || t[Cl] || ((t[Cl] = !0), mo('selectionchange', !1, t));
  }
}
function Fd(e, t, n, r) {
  switch (Sd(t)) {
    case 1:
      var l = tm;
      break;
    case 4:
      l = nm;
      break;
    default:
      l = rs;
  }
  ((n = l.bind(null, t, n, e)),
    (l = void 0),
    !Yo || (t !== 'touchstart' && t !== 'touchmove' && t !== 'wheel') || (l = !0),
    r
      ? l !== void 0
        ? e.addEventListener(t, n, { capture: !0, passive: l })
        : e.addEventListener(t, n, !0)
      : l !== void 0
        ? e.addEventListener(t, n, { passive: l })
        : e.addEventListener(t, n, !1));
}
function go(e, t, n, r, l) {
  var a = r;
  if (!(t & 1) && !(t & 2) && r !== null)
    e: for (;;) {
      if (r === null) return;
      var o = r.tag;
      if (o === 3 || o === 4) {
        var s = r.stateNode.containerInfo;
        if (s === l || (s.nodeType === 8 && s.parentNode === l)) break;
        if (o === 4)
          for (o = r.return; o !== null;) {
            var u = o.tag;
            if (
              (u === 3 || u === 4) &&
              ((u = o.stateNode.containerInfo), u === l || (u.nodeType === 8 && u.parentNode === l))
            )
              return;
            o = o.return;
          }
        for (; s !== null;) {
          if (((o = rn(s)), o === null)) return;
          if (((u = o.tag), u === 5 || u === 6)) {
            r = a = o;
            continue e;
          }
          s = s.parentNode;
        }
      }
      r = r.return;
    }
  ud(function () {
    var c = a,
      m = Zi(n),
      d = [];
    e: {
      var f = zd.get(e);
      if (f !== void 0) {
        var v = as,
          k = e;
        switch (e) {
          case 'keypress':
            if ($l(n) === 0) break e;
          case 'keydown':
          case 'keyup':
            v = vm;
            break;
          case 'focusin':
            ((k = 'focus'), (v = so));
            break;
          case 'focusout':
            ((k = 'blur'), (v = so));
            break;
          case 'beforeblur':
          case 'afterblur':
            v = so;
            break;
          case 'click':
            if (n.button === 2) break e;
          case 'auxclick':
          case 'dblclick':
          case 'mousedown':
          case 'mousemove':
          case 'mouseup':
          case 'mouseout':
          case 'mouseover':
          case 'contextmenu':
            v = ju;
            break;
          case 'drag':
          case 'dragend':
          case 'dragenter':
          case 'dragexit':
          case 'dragleave':
          case 'dragover':
          case 'dragstart':
          case 'drop':
            v = am;
            break;
          case 'touchcancel':
          case 'touchend':
          case 'touchmove':
          case 'touchstart':
            v = wm;
            break;
          case Od:
          case Id:
          case Ad:
            v = sm;
            break;
          case Dd:
            v = jm;
            break;
          case 'scroll':
            v = rm;
            break;
          case 'wheel':
            v = Nm;
            break;
          case 'copy':
          case 'cut':
          case 'paste':
            v = cm;
            break;
          case 'gotpointercapture':
          case 'lostpointercapture':
          case 'pointercancel':
          case 'pointerdown':
          case 'pointermove':
          case 'pointerout':
          case 'pointerover':
          case 'pointerup':
            v = Nu;
        }
        var w = (t & 4) !== 0,
          j = !w && e === 'scroll',
          h = w ? (f !== null ? f + 'Capture' : null) : f;
        w = [];
        for (var p = c, g; p !== null;) {
          g = p;
          var y = g.stateNode;
          if (
            (g.tag === 5 &&
              y !== null &&
              ((g = y), h !== null && ((y = Ar(p, h)), y != null && w.push(Vr(p, y, g)))),
            j)
          )
            break;
          p = p.return;
        }
        0 < w.length && ((f = new v(f, k, null, n, m)), d.push({ event: f, listeners: w }));
      }
    }
    if (!(t & 7)) {
      e: {
        if (
          ((f = e === 'mouseover' || e === 'pointerover'),
          (v = e === 'mouseout' || e === 'pointerout'),
          f && n !== Ko && (k = n.relatedTarget || n.fromElement) && (rn(k) || k[St]))
        )
          break e;
        if (
          (v || f) &&
          ((f =
            m.window === m ? m : (f = m.ownerDocument) ? f.defaultView || f.parentWindow : window),
          v
            ? ((k = n.relatedTarget || n.toElement),
              (v = c),
              (k = k ? rn(k) : null),
              k !== null && ((j = gn(k)), k !== j || (k.tag !== 5 && k.tag !== 6)) && (k = null))
            : ((v = null), (k = c)),
          v !== k)
        ) {
          if (
            ((w = ju),
            (y = 'onMouseLeave'),
            (h = 'onMouseEnter'),
            (p = 'mouse'),
            (e === 'pointerout' || e === 'pointerover') &&
              ((w = Nu), (y = 'onPointerLeave'), (h = 'onPointerEnter'), (p = 'pointer')),
            (j = v == null ? f : Tn(v)),
            (g = k == null ? f : Tn(k)),
            (f = new w(y, p + 'leave', v, n, m)),
            (f.target = j),
            (f.relatedTarget = g),
            (y = null),
            rn(m) === c &&
              ((w = new w(h, p + 'enter', k, n, m)),
              (w.target = g),
              (w.relatedTarget = j),
              (y = w)),
            (j = y),
            v && k)
          )
            t: {
              for (w = v, h = k, p = 0, g = w; g; g = jn(g)) p++;
              for (g = 0, y = h; y; y = jn(y)) g++;
              for (; 0 < p - g;) ((w = jn(w)), p--);
              for (; 0 < g - p;) ((h = jn(h)), g--);
              for (; p--;) {
                if (w === h || (h !== null && w === h.alternate)) break t;
                ((w = jn(w)), (h = jn(h)));
              }
              w = null;
            }
          else w = null;
          (v !== null && Iu(d, f, v, w, !1), k !== null && j !== null && Iu(d, j, k, w, !0));
        }
      }
      e: {
        if (
          ((f = c ? Tn(c) : window),
          (v = f.nodeName && f.nodeName.toLowerCase()),
          v === 'select' || (v === 'input' && f.type === 'file'))
        )
          var S = Rm;
        else if (_u(f))
          if (Td) S = Im;
          else {
            S = Mm;
            var N = bm;
          }
        else
          (v = f.nodeName) &&
            v.toLowerCase() === 'input' &&
            (f.type === 'checkbox' || f.type === 'radio') &&
            (S = Om);
        if (S && (S = S(e, c))) {
          Pd(d, S, n, m);
          break e;
        }
        (N && N(e, f, c),
          e === 'focusout' &&
            (N = f._wrapperState) &&
            N.controlled &&
            f.type === 'number' &&
            Uo(f, 'number', f.value));
      }
      switch (((N = c ? Tn(c) : window), e)) {
        case 'focusin':
          (_u(N) || N.contentEditable === 'true') && ((_n = N), (ei = c), (Pr = null));
          break;
        case 'focusout':
          Pr = ei = _n = null;
          break;
        case 'mousedown':
          ti = !0;
          break;
        case 'contextmenu':
        case 'mouseup':
        case 'dragend':
          ((ti = !1), bu(d, n, m));
          break;
        case 'selectionchange':
          if (zm) break;
        case 'keydown':
        case 'keyup':
          bu(d, n, m);
      }
      var _;
      if (is)
        e: {
          switch (e) {
            case 'compositionstart':
              var P = 'onCompositionStart';
              break e;
            case 'compositionend':
              P = 'onCompositionEnd';
              break e;
            case 'compositionupdate':
              P = 'onCompositionUpdate';
              break e;
          }
          P = void 0;
        }
      else
        En
          ? Ed(e, n) && (P = 'onCompositionEnd')
          : e === 'keydown' && n.keyCode === 229 && (P = 'onCompositionStart');
      (P &&
        (Cd &&
          n.locale !== 'ko' &&
          (En || P !== 'onCompositionStart'
            ? P === 'onCompositionEnd' && En && (_ = Nd())
            : ((Ot = m), (ls = 'value' in Ot ? Ot.value : Ot.textContent), (En = !0))),
        (N = ra(c, P)),
        0 < N.length &&
          ((P = new Su(P, e, null, n, m)),
          d.push({ event: P, listeners: N }),
          _ ? (P.data = _) : ((_ = _d(n)), _ !== null && (P.data = _)))),
        (_ = Em ? _m(e, n) : Pm(e, n)) &&
          ((c = ra(c, 'onBeforeInput')),
          0 < c.length &&
            ((m = new Su('onBeforeInput', 'beforeinput', null, n, m)),
            d.push({ event: m, listeners: c }),
            (m.data = _))));
    }
    Bd(d, t);
  });
}
function Vr(e, t, n) {
  return { instance: e, listener: t, currentTarget: n };
}
function ra(e, t) {
  for (var n = t + 'Capture', r = []; e !== null;) {
    var l = e,
      a = l.stateNode;
    (l.tag === 5 &&
      a !== null &&
      ((l = a),
      (a = Ar(e, n)),
      a != null && r.unshift(Vr(e, a, l)),
      (a = Ar(e, t)),
      a != null && r.push(Vr(e, a, l))),
      (e = e.return));
  }
  return r;
}
function jn(e) {
  if (e === null) return null;
  do e = e.return;
  while (e && e.tag !== 5);
  return e || null;
}
function Iu(e, t, n, r, l) {
  for (var a = t._reactName, o = []; n !== null && n !== r;) {
    var s = n,
      u = s.alternate,
      c = s.stateNode;
    if (u !== null && u === r) break;
    (s.tag === 5 &&
      c !== null &&
      ((s = c),
      l
        ? ((u = Ar(n, a)), u != null && o.unshift(Vr(n, u, s)))
        : l || ((u = Ar(n, a)), u != null && o.push(Vr(n, u, s)))),
      (n = n.return));
  }
  o.length !== 0 && e.push({ event: t, listeners: o });
}
var Um = /\r\n?/g,
  Vm = /\u0000|\uFFFD/g;
function Au(e) {
  return (typeof e == 'string' ? e : '' + e)
    .replace(
      Um,
      `
`,
    )
    .replace(Vm, '');
}
function El(e, t, n) {
  if (((t = Au(t)), Au(e) !== t && n)) throw Error(C(425));
}
function la() {}
var ni = null,
  ri = null;
function li(e, t) {
  return (
    e === 'textarea' ||
    e === 'noscript' ||
    typeof t.children == 'string' ||
    typeof t.children == 'number' ||
    (typeof t.dangerouslySetInnerHTML == 'object' &&
      t.dangerouslySetInnerHTML !== null &&
      t.dangerouslySetInnerHTML.__html != null)
  );
}
var ai = typeof setTimeout == 'function' ? setTimeout : void 0,
  Hm = typeof clearTimeout == 'function' ? clearTimeout : void 0,
  Du = typeof Promise == 'function' ? Promise : void 0,
  Wm =
    typeof queueMicrotask == 'function'
      ? queueMicrotask
      : typeof Du < 'u'
        ? function (e) {
            return Du.resolve(null).then(e).catch(Qm);
          }
        : ai;
function Qm(e) {
  setTimeout(function () {
    throw e;
  });
}
function vo(e, t) {
  var n = t,
    r = 0;
  do {
    var l = n.nextSibling;
    if ((e.removeChild(n), l && l.nodeType === 8))
      if (((n = l.data), n === '/$')) {
        if (r === 0) {
          (e.removeChild(l), Br(t));
          return;
        }
        r--;
      } else (n !== '$' && n !== '$?' && n !== '$!') || r++;
    n = l;
  } while (n);
  Br(t);
}
function $t(e) {
  for (; e != null; e = e.nextSibling) {
    var t = e.nodeType;
    if (t === 1 || t === 3) break;
    if (t === 8) {
      if (((t = e.data), t === '$' || t === '$!' || t === '$?')) break;
      if (t === '/$') return null;
    }
  }
  return e;
}
function zu(e) {
  e = e.previousSibling;
  for (var t = 0; e;) {
    if (e.nodeType === 8) {
      var n = e.data;
      if (n === '$' || n === '$!' || n === '$?') {
        if (t === 0) return e;
        t--;
      } else n === '/$' && t++;
    }
    e = e.previousSibling;
  }
  return null;
}
var ar = Math.random().toString(36).slice(2),
  at = '__reactFiber$' + ar,
  Hr = '__reactProps$' + ar,
  St = '__reactContainer$' + ar,
  oi = '__reactEvents$' + ar,
  Km = '__reactListeners$' + ar,
  qm = '__reactHandles$' + ar;
function rn(e) {
  var t = e[at];
  if (t) return t;
  for (var n = e.parentNode; n;) {
    if ((t = n[St] || n[at])) {
      if (((n = t.alternate), t.child !== null || (n !== null && n.child !== null)))
        for (e = zu(e); e !== null;) {
          if ((n = e[at])) return n;
          e = zu(e);
        }
      return t;
    }
    ((e = n), (n = e.parentNode));
  }
  return null;
}
function ol(e) {
  return (
    (e = e[at] || e[St]),
    !e || (e.tag !== 5 && e.tag !== 6 && e.tag !== 13 && e.tag !== 3) ? null : e
  );
}
function Tn(e) {
  if (e.tag === 5 || e.tag === 6) return e.stateNode;
  throw Error(C(33));
}
function Ta(e) {
  return e[Hr] || null;
}
var ii = [],
  Ln = -1;
function Jt(e) {
  return { current: e };
}
function V(e) {
  0 > Ln || ((e.current = ii[Ln]), (ii[Ln] = null), Ln--);
}
function F(e, t) {
  (Ln++, (ii[Ln] = e.current), (e.current = t));
}
var qt = {},
  ye = Jt(qt),
  Ce = Jt(!1),
  cn = qt;
function Hn(e, t) {
  var n = e.type.contextTypes;
  if (!n) return qt;
  var r = e.stateNode;
  if (r && r.__reactInternalMemoizedUnmaskedChildContext === t)
    return r.__reactInternalMemoizedMaskedChildContext;
  var l = {},
    a;
  for (a in n) l[a] = t[a];
  return (
    r &&
      ((e = e.stateNode),
      (e.__reactInternalMemoizedUnmaskedChildContext = t),
      (e.__reactInternalMemoizedMaskedChildContext = l)),
    l
  );
}
function Ee(e) {
  return ((e = e.childContextTypes), e != null);
}
function aa() {
  (V(Ce), V(ye));
}
function Bu(e, t, n) {
  if (ye.current !== qt) throw Error(C(168));
  (F(ye, t), F(Ce, n));
}
function $d(e, t, n) {
  var r = e.stateNode;
  if (((t = t.childContextTypes), typeof r.getChildContext != 'function')) return n;
  r = r.getChildContext();
  for (var l in r) if (!(l in t)) throw Error(C(108, bh(e) || 'Unknown', l));
  return q({}, n, r);
}
function oa(e) {
  return (
    (e = ((e = e.stateNode) && e.__reactInternalMemoizedMergedChildContext) || qt),
    (cn = ye.current),
    F(ye, e),
    F(Ce, Ce.current),
    !0
  );
}
function Fu(e, t, n) {
  var r = e.stateNode;
  if (!r) throw Error(C(169));
  (n
    ? ((e = $d(e, t, cn)),
      (r.__reactInternalMemoizedMergedChildContext = e),
      V(Ce),
      V(ye),
      F(ye, e))
    : V(Ce),
    F(Ce, n));
}
var yt = null,
  La = !1,
  yo = !1;
function Ud(e) {
  yt === null ? (yt = [e]) : yt.push(e);
}
function Ym(e) {
  ((La = !0), Ud(e));
}
function Gt() {
  if (!yo && yt !== null) {
    yo = !0;
    var e = 0,
      t = z;
    try {
      var n = yt;
      for (z = 1; e < n.length; e++) {
        var r = n[e];
        do r = r(!0);
        while (r !== null);
      }
      ((yt = null), (La = !1));
    } catch (l) {
      throw (yt !== null && (yt = yt.slice(e + 1)), pd(es, Gt), l);
    } finally {
      ((z = t), (yo = !1));
    }
  }
  return null;
}
var Rn = [],
  bn = 0,
  ia = null,
  sa = 0,
  Be = [],
  Fe = 0,
  dn = null,
  xt = 1,
  wt = '';
function en(e, t) {
  ((Rn[bn++] = sa), (Rn[bn++] = ia), (ia = e), (sa = t));
}
function Vd(e, t, n) {
  ((Be[Fe++] = xt), (Be[Fe++] = wt), (Be[Fe++] = dn), (dn = e));
  var r = xt;
  e = wt;
  var l = 32 - Ge(r) - 1;
  ((r &= ~(1 << l)), (n += 1));
  var a = 32 - Ge(t) + l;
  if (30 < a) {
    var o = l - (l % 5);
    ((a = (r & ((1 << o) - 1)).toString(32)),
      (r >>= o),
      (l -= o),
      (xt = (1 << (32 - Ge(t) + l)) | (n << l) | r),
      (wt = a + e));
  } else ((xt = (1 << a) | (n << l) | r), (wt = e));
}
function us(e) {
  e.return !== null && (en(e, 1), Vd(e, 1, 0));
}
function cs(e) {
  for (; e === ia;) ((ia = Rn[--bn]), (Rn[bn] = null), (sa = Rn[--bn]), (Rn[bn] = null));
  for (; e === dn;)
    ((dn = Be[--Fe]),
      (Be[Fe] = null),
      (wt = Be[--Fe]),
      (Be[Fe] = null),
      (xt = Be[--Fe]),
      (Be[Fe] = null));
}
var Re = null,
  Le = null,
  H = !1,
  Je = null;
function Hd(e, t) {
  var n = $e(5, null, null, 0);
  ((n.elementType = 'DELETED'),
    (n.stateNode = t),
    (n.return = e),
    (t = e.deletions),
    t === null ? ((e.deletions = [n]), (e.flags |= 16)) : t.push(n));
}
function $u(e, t) {
  switch (e.tag) {
    case 5:
      var n = e.type;
      return (
        (t = t.nodeType !== 1 || n.toLowerCase() !== t.nodeName.toLowerCase() ? null : t),
        t !== null ? ((e.stateNode = t), (Re = e), (Le = $t(t.firstChild)), !0) : !1
      );
    case 6:
      return (
        (t = e.pendingProps === '' || t.nodeType !== 3 ? null : t),
        t !== null ? ((e.stateNode = t), (Re = e), (Le = null), !0) : !1
      );
    case 13:
      return (
        (t = t.nodeType !== 8 ? null : t),
        t !== null
          ? ((n = dn !== null ? { id: xt, overflow: wt } : null),
            (e.memoizedState = { dehydrated: t, treeContext: n, retryLane: 1073741824 }),
            (n = $e(18, null, null, 0)),
            (n.stateNode = t),
            (n.return = e),
            (e.child = n),
            (Re = e),
            (Le = null),
            !0)
          : !1
      );
    default:
      return !1;
  }
}
function si(e) {
  return (e.mode & 1) !== 0 && (e.flags & 128) === 0;
}
function ui(e) {
  if (H) {
    var t = Le;
    if (t) {
      var n = t;
      if (!$u(e, t)) {
        if (si(e)) throw Error(C(418));
        t = $t(n.nextSibling);
        var r = Re;
        t && $u(e, t) ? Hd(r, n) : ((e.flags = (e.flags & -4097) | 2), (H = !1), (Re = e));
      }
    } else {
      if (si(e)) throw Error(C(418));
      ((e.flags = (e.flags & -4097) | 2), (H = !1), (Re = e));
    }
  }
}
function Uu(e) {
  for (e = e.return; e !== null && e.tag !== 5 && e.tag !== 3 && e.tag !== 13;) e = e.return;
  Re = e;
}
function _l(e) {
  if (e !== Re) return !1;
  if (!H) return (Uu(e), (H = !0), !1);
  var t;
  if (
    ((t = e.tag !== 3) &&
      !(t = e.tag !== 5) &&
      ((t = e.type), (t = t !== 'head' && t !== 'body' && !li(e.type, e.memoizedProps))),
    t && (t = Le))
  ) {
    if (si(e)) throw (Wd(), Error(C(418)));
    for (; t;) (Hd(e, t), (t = $t(t.nextSibling)));
  }
  if ((Uu(e), e.tag === 13)) {
    if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e)) throw Error(C(317));
    e: {
      for (e = e.nextSibling, t = 0; e;) {
        if (e.nodeType === 8) {
          var n = e.data;
          if (n === '/$') {
            if (t === 0) {
              Le = $t(e.nextSibling);
              break e;
            }
            t--;
          } else (n !== '$' && n !== '$!' && n !== '$?') || t++;
        }
        e = e.nextSibling;
      }
      Le = null;
    }
  } else Le = Re ? $t(e.stateNode.nextSibling) : null;
  return !0;
}
function Wd() {
  for (var e = Le; e;) e = $t(e.nextSibling);
}
function Wn() {
  ((Le = Re = null), (H = !1));
}
function ds(e) {
  Je === null ? (Je = [e]) : Je.push(e);
}
var Jm = Et.ReactCurrentBatchConfig;
function gr(e, t, n) {
  if (((e = n.ref), e !== null && typeof e != 'function' && typeof e != 'object')) {
    if (n._owner) {
      if (((n = n._owner), n)) {
        if (n.tag !== 1) throw Error(C(309));
        var r = n.stateNode;
      }
      if (!r) throw Error(C(147, e));
      var l = r,
        a = '' + e;
      return t !== null && t.ref !== null && typeof t.ref == 'function' && t.ref._stringRef === a
        ? t.ref
        : ((t = function (o) {
            var s = l.refs;
            o === null ? delete s[a] : (s[a] = o);
          }),
          (t._stringRef = a),
          t);
    }
    if (typeof e != 'string') throw Error(C(284));
    if (!n._owner) throw Error(C(290, e));
  }
  return e;
}
function Pl(e, t) {
  throw (
    (e = Object.prototype.toString.call(t)),
    Error(
      C(31, e === '[object Object]' ? 'object with keys {' + Object.keys(t).join(', ') + '}' : e),
    )
  );
}
function Vu(e) {
  var t = e._init;
  return t(e._payload);
}
function Qd(e) {
  function t(h, p) {
    if (e) {
      var g = h.deletions;
      g === null ? ((h.deletions = [p]), (h.flags |= 16)) : g.push(p);
    }
  }
  function n(h, p) {
    if (!e) return null;
    for (; p !== null;) (t(h, p), (p = p.sibling));
    return null;
  }
  function r(h, p) {
    for (h = new Map(); p !== null;)
      (p.key !== null ? h.set(p.key, p) : h.set(p.index, p), (p = p.sibling));
    return h;
  }
  function l(h, p) {
    return ((h = Wt(h, p)), (h.index = 0), (h.sibling = null), h);
  }
  function a(h, p, g) {
    return (
      (h.index = g),
      e
        ? ((g = h.alternate),
          g !== null ? ((g = g.index), g < p ? ((h.flags |= 2), p) : g) : ((h.flags |= 2), p))
        : ((h.flags |= 1048576), p)
    );
  }
  function o(h) {
    return (e && h.alternate === null && (h.flags |= 2), h);
  }
  function s(h, p, g, y) {
    return p === null || p.tag !== 6
      ? ((p = Co(g, h.mode, y)), (p.return = h), p)
      : ((p = l(p, g)), (p.return = h), p);
  }
  function u(h, p, g, y) {
    var S = g.type;
    return S === Cn
      ? m(h, p, g.props.children, y, g.key)
      : p !== null &&
          (p.elementType === S ||
            (typeof S == 'object' && S !== null && S.$$typeof === Lt && Vu(S) === p.type))
        ? ((y = l(p, g.props)), (y.ref = gr(h, p, g)), (y.return = h), y)
        : ((y = ql(g.type, g.key, g.props, null, h.mode, y)),
          (y.ref = gr(h, p, g)),
          (y.return = h),
          y);
  }
  function c(h, p, g, y) {
    return p === null ||
      p.tag !== 4 ||
      p.stateNode.containerInfo !== g.containerInfo ||
      p.stateNode.implementation !== g.implementation
      ? ((p = Eo(g, h.mode, y)), (p.return = h), p)
      : ((p = l(p, g.children || [])), (p.return = h), p);
  }
  function m(h, p, g, y, S) {
    return p === null || p.tag !== 7
      ? ((p = sn(g, h.mode, y, S)), (p.return = h), p)
      : ((p = l(p, g)), (p.return = h), p);
  }
  function d(h, p, g) {
    if ((typeof p == 'string' && p !== '') || typeof p == 'number')
      return ((p = Co('' + p, h.mode, g)), (p.return = h), p);
    if (typeof p == 'object' && p !== null) {
      switch (p.$$typeof) {
        case vl:
          return (
            (g = ql(p.type, p.key, p.props, null, h.mode, g)),
            (g.ref = gr(h, null, p)),
            (g.return = h),
            g
          );
        case Nn:
          return ((p = Eo(p, h.mode, g)), (p.return = h), p);
        case Lt:
          var y = p._init;
          return d(h, y(p._payload), g);
      }
      if (kr(p) || dr(p)) return ((p = sn(p, h.mode, g, null)), (p.return = h), p);
      Pl(h, p);
    }
    return null;
  }
  function f(h, p, g, y) {
    var S = p !== null ? p.key : null;
    if ((typeof g == 'string' && g !== '') || typeof g == 'number')
      return S !== null ? null : s(h, p, '' + g, y);
    if (typeof g == 'object' && g !== null) {
      switch (g.$$typeof) {
        case vl:
          return g.key === S ? u(h, p, g, y) : null;
        case Nn:
          return g.key === S ? c(h, p, g, y) : null;
        case Lt:
          return ((S = g._init), f(h, p, S(g._payload), y));
      }
      if (kr(g) || dr(g)) return S !== null ? null : m(h, p, g, y, null);
      Pl(h, g);
    }
    return null;
  }
  function v(h, p, g, y, S) {
    if ((typeof y == 'string' && y !== '') || typeof y == 'number')
      return ((h = h.get(g) || null), s(p, h, '' + y, S));
    if (typeof y == 'object' && y !== null) {
      switch (y.$$typeof) {
        case vl:
          return ((h = h.get(y.key === null ? g : y.key) || null), u(p, h, y, S));
        case Nn:
          return ((h = h.get(y.key === null ? g : y.key) || null), c(p, h, y, S));
        case Lt:
          var N = y._init;
          return v(h, p, g, N(y._payload), S);
      }
      if (kr(y) || dr(y)) return ((h = h.get(g) || null), m(p, h, y, S, null));
      Pl(p, y);
    }
    return null;
  }
  function k(h, p, g, y) {
    for (var S = null, N = null, _ = p, P = (p = 0), I = null; _ !== null && P < g.length; P++) {
      _.index > P ? ((I = _), (_ = null)) : (I = _.sibling);
      var T = f(h, _, g[P], y);
      if (T === null) {
        _ === null && (_ = I);
        break;
      }
      (e && _ && T.alternate === null && t(h, _),
        (p = a(T, p, P)),
        N === null ? (S = T) : (N.sibling = T),
        (N = T),
        (_ = I));
    }
    if (P === g.length) return (n(h, _), H && en(h, P), S);
    if (_ === null) {
      for (; P < g.length; P++)
        ((_ = d(h, g[P], y)),
          _ !== null && ((p = a(_, p, P)), N === null ? (S = _) : (N.sibling = _), (N = _)));
      return (H && en(h, P), S);
    }
    for (_ = r(h, _); P < g.length; P++)
      ((I = v(_, h, P, g[P], y)),
        I !== null &&
          (e && I.alternate !== null && _.delete(I.key === null ? P : I.key),
          (p = a(I, p, P)),
          N === null ? (S = I) : (N.sibling = I),
          (N = I)));
    return (
      e &&
        _.forEach(function (b) {
          return t(h, b);
        }),
      H && en(h, P),
      S
    );
  }
  function w(h, p, g, y) {
    var S = dr(g);
    if (typeof S != 'function') throw Error(C(150));
    if (((g = S.call(g)), g == null)) throw Error(C(151));
    for (
      var N = (S = null), _ = p, P = (p = 0), I = null, T = g.next();
      _ !== null && !T.done;
      P++, T = g.next()
    ) {
      _.index > P ? ((I = _), (_ = null)) : (I = _.sibling);
      var b = f(h, _, T.value, y);
      if (b === null) {
        _ === null && (_ = I);
        break;
      }
      (e && _ && b.alternate === null && t(h, _),
        (p = a(b, p, P)),
        N === null ? (S = b) : (N.sibling = b),
        (N = b),
        (_ = I));
    }
    if (T.done) return (n(h, _), H && en(h, P), S);
    if (_ === null) {
      for (; !T.done; P++, T = g.next())
        ((T = d(h, T.value, y)),
          T !== null && ((p = a(T, p, P)), N === null ? (S = T) : (N.sibling = T), (N = T)));
      return (H && en(h, P), S);
    }
    for (_ = r(h, _); !T.done; P++, T = g.next())
      ((T = v(_, h, P, T.value, y)),
        T !== null &&
          (e && T.alternate !== null && _.delete(T.key === null ? P : T.key),
          (p = a(T, p, P)),
          N === null ? (S = T) : (N.sibling = T),
          (N = T)));
    return (
      e &&
        _.forEach(function (re) {
          return t(h, re);
        }),
      H && en(h, P),
      S
    );
  }
  function j(h, p, g, y) {
    if (
      (typeof g == 'object' &&
        g !== null &&
        g.type === Cn &&
        g.key === null &&
        (g = g.props.children),
      typeof g == 'object' && g !== null)
    ) {
      switch (g.$$typeof) {
        case vl:
          e: {
            for (var S = g.key, N = p; N !== null;) {
              if (N.key === S) {
                if (((S = g.type), S === Cn)) {
                  if (N.tag === 7) {
                    (n(h, N.sibling), (p = l(N, g.props.children)), (p.return = h), (h = p));
                    break e;
                  }
                } else if (
                  N.elementType === S ||
                  (typeof S == 'object' && S !== null && S.$$typeof === Lt && Vu(S) === N.type)
                ) {
                  (n(h, N.sibling),
                    (p = l(N, g.props)),
                    (p.ref = gr(h, N, g)),
                    (p.return = h),
                    (h = p));
                  break e;
                }
                n(h, N);
                break;
              } else t(h, N);
              N = N.sibling;
            }
            g.type === Cn
              ? ((p = sn(g.props.children, h.mode, y, g.key)), (p.return = h), (h = p))
              : ((y = ql(g.type, g.key, g.props, null, h.mode, y)),
                (y.ref = gr(h, p, g)),
                (y.return = h),
                (h = y));
          }
          return o(h);
        case Nn:
          e: {
            for (N = g.key; p !== null;) {
              if (p.key === N)
                if (
                  p.tag === 4 &&
                  p.stateNode.containerInfo === g.containerInfo &&
                  p.stateNode.implementation === g.implementation
                ) {
                  (n(h, p.sibling), (p = l(p, g.children || [])), (p.return = h), (h = p));
                  break e;
                } else {
                  n(h, p);
                  break;
                }
              else t(h, p);
              p = p.sibling;
            }
            ((p = Eo(g, h.mode, y)), (p.return = h), (h = p));
          }
          return o(h);
        case Lt:
          return ((N = g._init), j(h, p, N(g._payload), y));
      }
      if (kr(g)) return k(h, p, g, y);
      if (dr(g)) return w(h, p, g, y);
      Pl(h, g);
    }
    return (typeof g == 'string' && g !== '') || typeof g == 'number'
      ? ((g = '' + g),
        p !== null && p.tag === 6
          ? (n(h, p.sibling), (p = l(p, g)), (p.return = h), (h = p))
          : (n(h, p), (p = Co(g, h.mode, y)), (p.return = h), (h = p)),
        o(h))
      : n(h, p);
  }
  return j;
}
var Qn = Qd(!0),
  Kd = Qd(!1),
  ua = Jt(null),
  ca = null,
  Mn = null,
  fs = null;
function ps() {
  fs = Mn = ca = null;
}
function hs(e) {
  var t = ua.current;
  (V(ua), (e._currentValue = t));
}
function ci(e, t, n) {
  for (; e !== null;) {
    var r = e.alternate;
    if (
      ((e.childLanes & t) !== t
        ? ((e.childLanes |= t), r !== null && (r.childLanes |= t))
        : r !== null && (r.childLanes & t) !== t && (r.childLanes |= t),
      e === n)
    )
      break;
    e = e.return;
  }
}
function Fn(e, t) {
  ((ca = e),
    (fs = Mn = null),
    (e = e.dependencies),
    e !== null && e.firstContext !== null && (e.lanes & t && (Ne = !0), (e.firstContext = null)));
}
function He(e) {
  var t = e._currentValue;
  if (fs !== e)
    if (((e = { context: e, memoizedValue: t, next: null }), Mn === null)) {
      if (ca === null) throw Error(C(308));
      ((Mn = e), (ca.dependencies = { lanes: 0, firstContext: e }));
    } else Mn = Mn.next = e;
  return t;
}
var ln = null;
function ms(e) {
  ln === null ? (ln = [e]) : ln.push(e);
}
function qd(e, t, n, r) {
  var l = t.interleaved;
  return (
    l === null ? ((n.next = n), ms(t)) : ((n.next = l.next), (l.next = n)),
    (t.interleaved = n),
    Nt(e, r)
  );
}
function Nt(e, t) {
  e.lanes |= t;
  var n = e.alternate;
  for (n !== null && (n.lanes |= t), n = e, e = e.return; e !== null;)
    ((e.childLanes |= t),
      (n = e.alternate),
      n !== null && (n.childLanes |= t),
      (n = e),
      (e = e.return));
  return n.tag === 3 ? n.stateNode : null;
}
var Rt = !1;
function gs(e) {
  e.updateQueue = {
    baseState: e.memoizedState,
    firstBaseUpdate: null,
    lastBaseUpdate: null,
    shared: { pending: null, interleaved: null, lanes: 0 },
    effects: null,
  };
}
function Yd(e, t) {
  ((e = e.updateQueue),
    t.updateQueue === e &&
      (t.updateQueue = {
        baseState: e.baseState,
        firstBaseUpdate: e.firstBaseUpdate,
        lastBaseUpdate: e.lastBaseUpdate,
        shared: e.shared,
        effects: e.effects,
      }));
}
function kt(e, t) {
  return { eventTime: e, lane: t, tag: 0, payload: null, callback: null, next: null };
}
function Ut(e, t, n) {
  var r = e.updateQueue;
  if (r === null) return null;
  if (((r = r.shared), D & 2)) {
    var l = r.pending;
    return (
      l === null ? (t.next = t) : ((t.next = l.next), (l.next = t)),
      (r.pending = t),
      Nt(e, n)
    );
  }
  return (
    (l = r.interleaved),
    l === null ? ((t.next = t), ms(r)) : ((t.next = l.next), (l.next = t)),
    (r.interleaved = t),
    Nt(e, n)
  );
}
function Ul(e, t, n) {
  if (((t = t.updateQueue), t !== null && ((t = t.shared), (n & 4194240) !== 0))) {
    var r = t.lanes;
    ((r &= e.pendingLanes), (n |= r), (t.lanes = n), ts(e, n));
  }
}
function Hu(e, t) {
  var n = e.updateQueue,
    r = e.alternate;
  if (r !== null && ((r = r.updateQueue), n === r)) {
    var l = null,
      a = null;
    if (((n = n.firstBaseUpdate), n !== null)) {
      do {
        var o = {
          eventTime: n.eventTime,
          lane: n.lane,
          tag: n.tag,
          payload: n.payload,
          callback: n.callback,
          next: null,
        };
        (a === null ? (l = a = o) : (a = a.next = o), (n = n.next));
      } while (n !== null);
      a === null ? (l = a = t) : (a = a.next = t);
    } else l = a = t;
    ((n = {
      baseState: r.baseState,
      firstBaseUpdate: l,
      lastBaseUpdate: a,
      shared: r.shared,
      effects: r.effects,
    }),
      (e.updateQueue = n));
    return;
  }
  ((e = n.lastBaseUpdate),
    e === null ? (n.firstBaseUpdate = t) : (e.next = t),
    (n.lastBaseUpdate = t));
}
function da(e, t, n, r) {
  var l = e.updateQueue;
  Rt = !1;
  var a = l.firstBaseUpdate,
    o = l.lastBaseUpdate,
    s = l.shared.pending;
  if (s !== null) {
    l.shared.pending = null;
    var u = s,
      c = u.next;
    ((u.next = null), o === null ? (a = c) : (o.next = c), (o = u));
    var m = e.alternate;
    m !== null &&
      ((m = m.updateQueue),
      (s = m.lastBaseUpdate),
      s !== o && (s === null ? (m.firstBaseUpdate = c) : (s.next = c), (m.lastBaseUpdate = u)));
  }
  if (a !== null) {
    var d = l.baseState;
    ((o = 0), (m = c = u = null), (s = a));
    do {
      var f = s.lane,
        v = s.eventTime;
      if ((r & f) === f) {
        m !== null &&
          (m = m.next =
            {
              eventTime: v,
              lane: 0,
              tag: s.tag,
              payload: s.payload,
              callback: s.callback,
              next: null,
            });
        e: {
          var k = e,
            w = s;
          switch (((f = t), (v = n), w.tag)) {
            case 1:
              if (((k = w.payload), typeof k == 'function')) {
                d = k.call(v, d, f);
                break e;
              }
              d = k;
              break e;
            case 3:
              k.flags = (k.flags & -65537) | 128;
            case 0:
              if (((k = w.payload), (f = typeof k == 'function' ? k.call(v, d, f) : k), f == null))
                break e;
              d = q({}, d, f);
              break e;
            case 2:
              Rt = !0;
          }
        }
        s.callback !== null &&
          s.lane !== 0 &&
          ((e.flags |= 64), (f = l.effects), f === null ? (l.effects = [s]) : f.push(s));
      } else
        ((v = {
          eventTime: v,
          lane: f,
          tag: s.tag,
          payload: s.payload,
          callback: s.callback,
          next: null,
        }),
          m === null ? ((c = m = v), (u = d)) : (m = m.next = v),
          (o |= f));
      if (((s = s.next), s === null)) {
        if (((s = l.shared.pending), s === null)) break;
        ((f = s), (s = f.next), (f.next = null), (l.lastBaseUpdate = f), (l.shared.pending = null));
      }
    } while (!0);
    if (
      (m === null && (u = d),
      (l.baseState = u),
      (l.firstBaseUpdate = c),
      (l.lastBaseUpdate = m),
      (t = l.shared.interleaved),
      t !== null)
    ) {
      l = t;
      do ((o |= l.lane), (l = l.next));
      while (l !== t);
    } else a === null && (l.shared.lanes = 0);
    ((pn |= o), (e.lanes = o), (e.memoizedState = d));
  }
}
function Wu(e, t, n) {
  if (((e = t.effects), (t.effects = null), e !== null))
    for (t = 0; t < e.length; t++) {
      var r = e[t],
        l = r.callback;
      if (l !== null) {
        if (((r.callback = null), (r = n), typeof l != 'function')) throw Error(C(191, l));
        l.call(r);
      }
    }
}
var il = {},
  st = Jt(il),
  Wr = Jt(il),
  Qr = Jt(il);
function an(e) {
  if (e === il) throw Error(C(174));
  return e;
}
function vs(e, t) {
  switch ((F(Qr, t), F(Wr, e), F(st, il), (e = t.nodeType), e)) {
    case 9:
    case 11:
      t = (t = t.documentElement) ? t.namespaceURI : Ho(null, '');
      break;
    default:
      ((e = e === 8 ? t.parentNode : t),
        (t = e.namespaceURI || null),
        (e = e.tagName),
        (t = Ho(t, e)));
  }
  (V(st), F(st, t));
}
function Kn() {
  (V(st), V(Wr), V(Qr));
}
function Jd(e) {
  an(Qr.current);
  var t = an(st.current),
    n = Ho(t, e.type);
  t !== n && (F(Wr, e), F(st, n));
}
function ys(e) {
  Wr.current === e && (V(st), V(Wr));
}
var W = Jt(0);
function fa(e) {
  for (var t = e; t !== null;) {
    if (t.tag === 13) {
      var n = t.memoizedState;
      if (n !== null && ((n = n.dehydrated), n === null || n.data === '$?' || n.data === '$!'))
        return t;
    } else if (t.tag === 19 && t.memoizedProps.revealOrder !== void 0) {
      if (t.flags & 128) return t;
    } else if (t.child !== null) {
      ((t.child.return = t), (t = t.child));
      continue;
    }
    if (t === e) break;
    for (; t.sibling === null;) {
      if (t.return === null || t.return === e) return null;
      t = t.return;
    }
    ((t.sibling.return = t.return), (t = t.sibling));
  }
  return null;
}
var xo = [];
function xs() {
  for (var e = 0; e < xo.length; e++) xo[e]._workInProgressVersionPrimary = null;
  xo.length = 0;
}
var Vl = Et.ReactCurrentDispatcher,
  wo = Et.ReactCurrentBatchConfig,
  fn = 0,
  Q = null,
  ae = null,
  ie = null,
  pa = !1,
  Tr = !1,
  Kr = 0,
  Gm = 0;
function he() {
  throw Error(C(321));
}
function ws(e, t) {
  if (t === null) return !1;
  for (var n = 0; n < t.length && n < e.length; n++) if (!Ze(e[n], t[n])) return !1;
  return !0;
}
function ks(e, t, n, r, l, a) {
  if (
    ((fn = a),
    (Q = t),
    (t.memoizedState = null),
    (t.updateQueue = null),
    (t.lanes = 0),
    (Vl.current = e === null || e.memoizedState === null ? tg : ng),
    (e = n(r, l)),
    Tr)
  ) {
    a = 0;
    do {
      if (((Tr = !1), (Kr = 0), 25 <= a)) throw Error(C(301));
      ((a += 1), (ie = ae = null), (t.updateQueue = null), (Vl.current = rg), (e = n(r, l)));
    } while (Tr);
  }
  if (
    ((Vl.current = ha),
    (t = ae !== null && ae.next !== null),
    (fn = 0),
    (ie = ae = Q = null),
    (pa = !1),
    t)
  )
    throw Error(C(300));
  return e;
}
function js() {
  var e = Kr !== 0;
  return ((Kr = 0), e);
}
function lt() {
  var e = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
  return (ie === null ? (Q.memoizedState = ie = e) : (ie = ie.next = e), ie);
}
function We() {
  if (ae === null) {
    var e = Q.alternate;
    e = e !== null ? e.memoizedState : null;
  } else e = ae.next;
  var t = ie === null ? Q.memoizedState : ie.next;
  if (t !== null) ((ie = t), (ae = e));
  else {
    if (e === null) throw Error(C(310));
    ((ae = e),
      (e = {
        memoizedState: ae.memoizedState,
        baseState: ae.baseState,
        baseQueue: ae.baseQueue,
        queue: ae.queue,
        next: null,
      }),
      ie === null ? (Q.memoizedState = ie = e) : (ie = ie.next = e));
  }
  return ie;
}
function qr(e, t) {
  return typeof t == 'function' ? t(e) : t;
}
function ko(e) {
  var t = We(),
    n = t.queue;
  if (n === null) throw Error(C(311));
  n.lastRenderedReducer = e;
  var r = ae,
    l = r.baseQueue,
    a = n.pending;
  if (a !== null) {
    if (l !== null) {
      var o = l.next;
      ((l.next = a.next), (a.next = o));
    }
    ((r.baseQueue = l = a), (n.pending = null));
  }
  if (l !== null) {
    ((a = l.next), (r = r.baseState));
    var s = (o = null),
      u = null,
      c = a;
    do {
      var m = c.lane;
      if ((fn & m) === m)
        (u !== null &&
          (u = u.next =
            {
              lane: 0,
              action: c.action,
              hasEagerState: c.hasEagerState,
              eagerState: c.eagerState,
              next: null,
            }),
          (r = c.hasEagerState ? c.eagerState : e(r, c.action)));
      else {
        var d = {
          lane: m,
          action: c.action,
          hasEagerState: c.hasEagerState,
          eagerState: c.eagerState,
          next: null,
        };
        (u === null ? ((s = u = d), (o = r)) : (u = u.next = d), (Q.lanes |= m), (pn |= m));
      }
      c = c.next;
    } while (c !== null && c !== a);
    (u === null ? (o = r) : (u.next = s),
      Ze(r, t.memoizedState) || (Ne = !0),
      (t.memoizedState = r),
      (t.baseState = o),
      (t.baseQueue = u),
      (n.lastRenderedState = r));
  }
  if (((e = n.interleaved), e !== null)) {
    l = e;
    do ((a = l.lane), (Q.lanes |= a), (pn |= a), (l = l.next));
    while (l !== e);
  } else l === null && (n.lanes = 0);
  return [t.memoizedState, n.dispatch];
}
function jo(e) {
  var t = We(),
    n = t.queue;
  if (n === null) throw Error(C(311));
  n.lastRenderedReducer = e;
  var r = n.dispatch,
    l = n.pending,
    a = t.memoizedState;
  if (l !== null) {
    n.pending = null;
    var o = (l = l.next);
    do ((a = e(a, o.action)), (o = o.next));
    while (o !== l);
    (Ze(a, t.memoizedState) || (Ne = !0),
      (t.memoizedState = a),
      t.baseQueue === null && (t.baseState = a),
      (n.lastRenderedState = a));
  }
  return [a, r];
}
function Gd() {}
function Xd(e, t) {
  var n = Q,
    r = We(),
    l = t(),
    a = !Ze(r.memoizedState, l);
  if (
    (a && ((r.memoizedState = l), (Ne = !0)),
    (r = r.queue),
    Ss(tf.bind(null, n, r, e), [e]),
    r.getSnapshot !== t || a || (ie !== null && ie.memoizedState.tag & 1))
  ) {
    if (((n.flags |= 2048), Yr(9, ef.bind(null, n, r, l, t), void 0, null), ue === null))
      throw Error(C(349));
    fn & 30 || Zd(n, t, l);
  }
  return l;
}
function Zd(e, t, n) {
  ((e.flags |= 16384),
    (e = { getSnapshot: t, value: n }),
    (t = Q.updateQueue),
    t === null
      ? ((t = { lastEffect: null, stores: null }), (Q.updateQueue = t), (t.stores = [e]))
      : ((n = t.stores), n === null ? (t.stores = [e]) : n.push(e)));
}
function ef(e, t, n, r) {
  ((t.value = n), (t.getSnapshot = r), nf(t) && rf(e));
}
function tf(e, t, n) {
  return n(function () {
    nf(t) && rf(e);
  });
}
function nf(e) {
  var t = e.getSnapshot;
  e = e.value;
  try {
    var n = t();
    return !Ze(e, n);
  } catch {
    return !0;
  }
}
function rf(e) {
  var t = Nt(e, 1);
  t !== null && Xe(t, e, 1, -1);
}
function Qu(e) {
  var t = lt();
  return (
    typeof e == 'function' && (e = e()),
    (t.memoizedState = t.baseState = e),
    (e = {
      pending: null,
      interleaved: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: qr,
      lastRenderedState: e,
    }),
    (t.queue = e),
    (e = e.dispatch = eg.bind(null, Q, e)),
    [t.memoizedState, e]
  );
}
function Yr(e, t, n, r) {
  return (
    (e = { tag: e, create: t, destroy: n, deps: r, next: null }),
    (t = Q.updateQueue),
    t === null
      ? ((t = { lastEffect: null, stores: null }), (Q.updateQueue = t), (t.lastEffect = e.next = e))
      : ((n = t.lastEffect),
        n === null
          ? (t.lastEffect = e.next = e)
          : ((r = n.next), (n.next = e), (e.next = r), (t.lastEffect = e))),
    e
  );
}
function lf() {
  return We().memoizedState;
}
function Hl(e, t, n, r) {
  var l = lt();
  ((Q.flags |= e), (l.memoizedState = Yr(1 | t, n, void 0, r === void 0 ? null : r)));
}
function Ra(e, t, n, r) {
  var l = We();
  r = r === void 0 ? null : r;
  var a = void 0;
  if (ae !== null) {
    var o = ae.memoizedState;
    if (((a = o.destroy), r !== null && ws(r, o.deps))) {
      l.memoizedState = Yr(t, n, a, r);
      return;
    }
  }
  ((Q.flags |= e), (l.memoizedState = Yr(1 | t, n, a, r)));
}
function Ku(e, t) {
  return Hl(8390656, 8, e, t);
}
function Ss(e, t) {
  return Ra(2048, 8, e, t);
}
function af(e, t) {
  return Ra(4, 2, e, t);
}
function of(e, t) {
  return Ra(4, 4, e, t);
}
function sf(e, t) {
  if (typeof t == 'function')
    return (
      (e = e()),
      t(e),
      function () {
        t(null);
      }
    );
  if (t != null)
    return (
      (e = e()),
      (t.current = e),
      function () {
        t.current = null;
      }
    );
}
function uf(e, t, n) {
  return ((n = n != null ? n.concat([e]) : null), Ra(4, 4, sf.bind(null, t, e), n));
}
function Ns() {}
function cf(e, t) {
  var n = We();
  t = t === void 0 ? null : t;
  var r = n.memoizedState;
  return r !== null && t !== null && ws(t, r[1]) ? r[0] : ((n.memoizedState = [e, t]), e);
}
function df(e, t) {
  var n = We();
  t = t === void 0 ? null : t;
  var r = n.memoizedState;
  return r !== null && t !== null && ws(t, r[1])
    ? r[0]
    : ((e = e()), (n.memoizedState = [e, t]), e);
}
function ff(e, t, n) {
  return fn & 21
    ? (Ze(n, t) || ((n = gd()), (Q.lanes |= n), (pn |= n), (e.baseState = !0)), t)
    : (e.baseState && ((e.baseState = !1), (Ne = !0)), (e.memoizedState = n));
}
function Xm(e, t) {
  var n = z;
  ((z = n !== 0 && 4 > n ? n : 4), e(!0));
  var r = wo.transition;
  wo.transition = {};
  try {
    (e(!1), t());
  } finally {
    ((z = n), (wo.transition = r));
  }
}
function pf() {
  return We().memoizedState;
}
function Zm(e, t, n) {
  var r = Ht(e);
  if (((n = { lane: r, action: n, hasEagerState: !1, eagerState: null, next: null }), hf(e)))
    mf(t, n);
  else if (((n = qd(e, t, n, r)), n !== null)) {
    var l = we();
    (Xe(n, e, r, l), gf(n, t, r));
  }
}
function eg(e, t, n) {
  var r = Ht(e),
    l = { lane: r, action: n, hasEagerState: !1, eagerState: null, next: null };
  if (hf(e)) mf(t, l);
  else {
    var a = e.alternate;
    if (e.lanes === 0 && (a === null || a.lanes === 0) && ((a = t.lastRenderedReducer), a !== null))
      try {
        var o = t.lastRenderedState,
          s = a(o, n);
        if (((l.hasEagerState = !0), (l.eagerState = s), Ze(s, o))) {
          var u = t.interleaved;
          (u === null ? ((l.next = l), ms(t)) : ((l.next = u.next), (u.next = l)),
            (t.interleaved = l));
          return;
        }
      } catch {
      } finally {
      }
    ((n = qd(e, t, l, r)), n !== null && ((l = we()), Xe(n, e, r, l), gf(n, t, r)));
  }
}
function hf(e) {
  var t = e.alternate;
  return e === Q || (t !== null && t === Q);
}
function mf(e, t) {
  Tr = pa = !0;
  var n = e.pending;
  (n === null ? (t.next = t) : ((t.next = n.next), (n.next = t)), (e.pending = t));
}
function gf(e, t, n) {
  if (n & 4194240) {
    var r = t.lanes;
    ((r &= e.pendingLanes), (n |= r), (t.lanes = n), ts(e, n));
  }
}
var ha = {
    readContext: He,
    useCallback: he,
    useContext: he,
    useEffect: he,
    useImperativeHandle: he,
    useInsertionEffect: he,
    useLayoutEffect: he,
    useMemo: he,
    useReducer: he,
    useRef: he,
    useState: he,
    useDebugValue: he,
    useDeferredValue: he,
    useTransition: he,
    useMutableSource: he,
    useSyncExternalStore: he,
    useId: he,
    unstable_isNewReconciler: !1,
  },
  tg = {
    readContext: He,
    useCallback: function (e, t) {
      return ((lt().memoizedState = [e, t === void 0 ? null : t]), e);
    },
    useContext: He,
    useEffect: Ku,
    useImperativeHandle: function (e, t, n) {
      return ((n = n != null ? n.concat([e]) : null), Hl(4194308, 4, sf.bind(null, t, e), n));
    },
    useLayoutEffect: function (e, t) {
      return Hl(4194308, 4, e, t);
    },
    useInsertionEffect: function (e, t) {
      return Hl(4, 2, e, t);
    },
    useMemo: function (e, t) {
      var n = lt();
      return ((t = t === void 0 ? null : t), (e = e()), (n.memoizedState = [e, t]), e);
    },
    useReducer: function (e, t, n) {
      var r = lt();
      return (
        (t = n !== void 0 ? n(t) : t),
        (r.memoizedState = r.baseState = t),
        (e = {
          pending: null,
          interleaved: null,
          lanes: 0,
          dispatch: null,
          lastRenderedReducer: e,
          lastRenderedState: t,
        }),
        (r.queue = e),
        (e = e.dispatch = Zm.bind(null, Q, e)),
        [r.memoizedState, e]
      );
    },
    useRef: function (e) {
      var t = lt();
      return ((e = { current: e }), (t.memoizedState = e));
    },
    useState: Qu,
    useDebugValue: Ns,
    useDeferredValue: function (e) {
      return (lt().memoizedState = e);
    },
    useTransition: function () {
      var e = Qu(!1),
        t = e[0];
      return ((e = Xm.bind(null, e[1])), (lt().memoizedState = e), [t, e]);
    },
    useMutableSource: function () {},
    useSyncExternalStore: function (e, t, n) {
      var r = Q,
        l = lt();
      if (H) {
        if (n === void 0) throw Error(C(407));
        n = n();
      } else {
        if (((n = t()), ue === null)) throw Error(C(349));
        fn & 30 || Zd(r, t, n);
      }
      l.memoizedState = n;
      var a = { value: n, getSnapshot: t };
      return (
        (l.queue = a),
        Ku(tf.bind(null, r, a, e), [e]),
        (r.flags |= 2048),
        Yr(9, ef.bind(null, r, a, n, t), void 0, null),
        n
      );
    },
    useId: function () {
      var e = lt(),
        t = ue.identifierPrefix;
      if (H) {
        var n = wt,
          r = xt;
        ((n = (r & ~(1 << (32 - Ge(r) - 1))).toString(32) + n),
          (t = ':' + t + 'R' + n),
          (n = Kr++),
          0 < n && (t += 'H' + n.toString(32)),
          (t += ':'));
      } else ((n = Gm++), (t = ':' + t + 'r' + n.toString(32) + ':'));
      return (e.memoizedState = t);
    },
    unstable_isNewReconciler: !1,
  },
  ng = {
    readContext: He,
    useCallback: cf,
    useContext: He,
    useEffect: Ss,
    useImperativeHandle: uf,
    useInsertionEffect: af,
    useLayoutEffect: of,
    useMemo: df,
    useReducer: ko,
    useRef: lf,
    useState: function () {
      return ko(qr);
    },
    useDebugValue: Ns,
    useDeferredValue: function (e) {
      var t = We();
      return ff(t, ae.memoizedState, e);
    },
    useTransition: function () {
      var e = ko(qr)[0],
        t = We().memoizedState;
      return [e, t];
    },
    useMutableSource: Gd,
    useSyncExternalStore: Xd,
    useId: pf,
    unstable_isNewReconciler: !1,
  },
  rg = {
    readContext: He,
    useCallback: cf,
    useContext: He,
    useEffect: Ss,
    useImperativeHandle: uf,
    useInsertionEffect: af,
    useLayoutEffect: of,
    useMemo: df,
    useReducer: jo,
    useRef: lf,
    useState: function () {
      return jo(qr);
    },
    useDebugValue: Ns,
    useDeferredValue: function (e) {
      var t = We();
      return ae === null ? (t.memoizedState = e) : ff(t, ae.memoizedState, e);
    },
    useTransition: function () {
      var e = jo(qr)[0],
        t = We().memoizedState;
      return [e, t];
    },
    useMutableSource: Gd,
    useSyncExternalStore: Xd,
    useId: pf,
    unstable_isNewReconciler: !1,
  };
function qe(e, t) {
  if (e && e.defaultProps) {
    ((t = q({}, t)), (e = e.defaultProps));
    for (var n in e) t[n] === void 0 && (t[n] = e[n]);
    return t;
  }
  return t;
}
function di(e, t, n, r) {
  ((t = e.memoizedState),
    (n = n(r, t)),
    (n = n == null ? t : q({}, t, n)),
    (e.memoizedState = n),
    e.lanes === 0 && (e.updateQueue.baseState = n));
}
var ba = {
  isMounted: function (e) {
    return (e = e._reactInternals) ? gn(e) === e : !1;
  },
  enqueueSetState: function (e, t, n) {
    e = e._reactInternals;
    var r = we(),
      l = Ht(e),
      a = kt(r, l);
    ((a.payload = t),
      n != null && (a.callback = n),
      (t = Ut(e, a, l)),
      t !== null && (Xe(t, e, l, r), Ul(t, e, l)));
  },
  enqueueReplaceState: function (e, t, n) {
    e = e._reactInternals;
    var r = we(),
      l = Ht(e),
      a = kt(r, l);
    ((a.tag = 1),
      (a.payload = t),
      n != null && (a.callback = n),
      (t = Ut(e, a, l)),
      t !== null && (Xe(t, e, l, r), Ul(t, e, l)));
  },
  enqueueForceUpdate: function (e, t) {
    e = e._reactInternals;
    var n = we(),
      r = Ht(e),
      l = kt(n, r);
    ((l.tag = 2),
      t != null && (l.callback = t),
      (t = Ut(e, l, r)),
      t !== null && (Xe(t, e, r, n), Ul(t, e, r)));
  },
};
function qu(e, t, n, r, l, a, o) {
  return (
    (e = e.stateNode),
    typeof e.shouldComponentUpdate == 'function'
      ? e.shouldComponentUpdate(r, a, o)
      : t.prototype && t.prototype.isPureReactComponent
        ? !$r(n, r) || !$r(l, a)
        : !0
  );
}
function vf(e, t, n) {
  var r = !1,
    l = qt,
    a = t.contextType;
  return (
    typeof a == 'object' && a !== null
      ? (a = He(a))
      : ((l = Ee(t) ? cn : ye.current),
        (r = t.contextTypes),
        (a = (r = r != null) ? Hn(e, l) : qt)),
    (t = new t(n, a)),
    (e.memoizedState = t.state !== null && t.state !== void 0 ? t.state : null),
    (t.updater = ba),
    (e.stateNode = t),
    (t._reactInternals = e),
    r &&
      ((e = e.stateNode),
      (e.__reactInternalMemoizedUnmaskedChildContext = l),
      (e.__reactInternalMemoizedMaskedChildContext = a)),
    t
  );
}
function Yu(e, t, n, r) {
  ((e = t.state),
    typeof t.componentWillReceiveProps == 'function' && t.componentWillReceiveProps(n, r),
    typeof t.UNSAFE_componentWillReceiveProps == 'function' &&
      t.UNSAFE_componentWillReceiveProps(n, r),
    t.state !== e && ba.enqueueReplaceState(t, t.state, null));
}
function fi(e, t, n, r) {
  var l = e.stateNode;
  ((l.props = n), (l.state = e.memoizedState), (l.refs = {}), gs(e));
  var a = t.contextType;
  (typeof a == 'object' && a !== null
    ? (l.context = He(a))
    : ((a = Ee(t) ? cn : ye.current), (l.context = Hn(e, a))),
    (l.state = e.memoizedState),
    (a = t.getDerivedStateFromProps),
    typeof a == 'function' && (di(e, t, a, n), (l.state = e.memoizedState)),
    typeof t.getDerivedStateFromProps == 'function' ||
      typeof l.getSnapshotBeforeUpdate == 'function' ||
      (typeof l.UNSAFE_componentWillMount != 'function' &&
        typeof l.componentWillMount != 'function') ||
      ((t = l.state),
      typeof l.componentWillMount == 'function' && l.componentWillMount(),
      typeof l.UNSAFE_componentWillMount == 'function' && l.UNSAFE_componentWillMount(),
      t !== l.state && ba.enqueueReplaceState(l, l.state, null),
      da(e, n, l, r),
      (l.state = e.memoizedState)),
    typeof l.componentDidMount == 'function' && (e.flags |= 4194308));
}
function qn(e, t) {
  try {
    var n = '',
      r = t;
    do ((n += Rh(r)), (r = r.return));
    while (r);
    var l = n;
  } catch (a) {
    l =
      `
Error generating stack: ` +
      a.message +
      `
` +
      a.stack;
  }
  return { value: e, source: t, stack: l, digest: null };
}
function So(e, t, n) {
  return { value: e, source: null, stack: n ?? null, digest: t ?? null };
}
function pi(e, t) {
  try {
    console.error(t.value);
  } catch (n) {
    setTimeout(function () {
      throw n;
    });
  }
}
var lg = typeof WeakMap == 'function' ? WeakMap : Map;
function yf(e, t, n) {
  ((n = kt(-1, n)), (n.tag = 3), (n.payload = { element: null }));
  var r = t.value;
  return (
    (n.callback = function () {
      (ga || ((ga = !0), (Si = r)), pi(e, t));
    }),
    n
  );
}
function xf(e, t, n) {
  ((n = kt(-1, n)), (n.tag = 3));
  var r = e.type.getDerivedStateFromError;
  if (typeof r == 'function') {
    var l = t.value;
    ((n.payload = function () {
      return r(l);
    }),
      (n.callback = function () {
        pi(e, t);
      }));
  }
  var a = e.stateNode;
  return (
    a !== null &&
      typeof a.componentDidCatch == 'function' &&
      (n.callback = function () {
        (pi(e, t), typeof r != 'function' && (Vt === null ? (Vt = new Set([this])) : Vt.add(this)));
        var o = t.stack;
        this.componentDidCatch(t.value, { componentStack: o !== null ? o : '' });
      }),
    n
  );
}
function Ju(e, t, n) {
  var r = e.pingCache;
  if (r === null) {
    r = e.pingCache = new lg();
    var l = new Set();
    r.set(t, l);
  } else ((l = r.get(t)), l === void 0 && ((l = new Set()), r.set(t, l)));
  l.has(n) || (l.add(n), (e = yg.bind(null, e, t, n)), t.then(e, e));
}
function Gu(e) {
  do {
    var t;
    if (
      ((t = e.tag === 13) && ((t = e.memoizedState), (t = t !== null ? t.dehydrated !== null : !0)),
      t)
    )
      return e;
    e = e.return;
  } while (e !== null);
  return null;
}
function Xu(e, t, n, r, l) {
  return e.mode & 1
    ? ((e.flags |= 65536), (e.lanes = l), e)
    : (e === t
        ? (e.flags |= 65536)
        : ((e.flags |= 128),
          (n.flags |= 131072),
          (n.flags &= -52805),
          n.tag === 1 &&
            (n.alternate === null ? (n.tag = 17) : ((t = kt(-1, 1)), (t.tag = 2), Ut(n, t, 1))),
          (n.lanes |= 1)),
      e);
}
var ag = Et.ReactCurrentOwner,
  Ne = !1;
function xe(e, t, n, r) {
  t.child = e === null ? Kd(t, null, n, r) : Qn(t, e.child, n, r);
}
function Zu(e, t, n, r, l) {
  n = n.render;
  var a = t.ref;
  return (
    Fn(t, l),
    (r = ks(e, t, n, r, a, l)),
    (n = js()),
    e !== null && !Ne
      ? ((t.updateQueue = e.updateQueue), (t.flags &= -2053), (e.lanes &= ~l), Ct(e, t, l))
      : (H && n && us(t), (t.flags |= 1), xe(e, t, r, l), t.child)
  );
}
function ec(e, t, n, r, l) {
  if (e === null) {
    var a = n.type;
    return typeof a == 'function' &&
      !bs(a) &&
      a.defaultProps === void 0 &&
      n.compare === null &&
      n.defaultProps === void 0
      ? ((t.tag = 15), (t.type = a), wf(e, t, a, r, l))
      : ((e = ql(n.type, null, r, t, t.mode, l)), (e.ref = t.ref), (e.return = t), (t.child = e));
  }
  if (((a = e.child), !(e.lanes & l))) {
    var o = a.memoizedProps;
    if (((n = n.compare), (n = n !== null ? n : $r), n(o, r) && e.ref === t.ref))
      return Ct(e, t, l);
  }
  return ((t.flags |= 1), (e = Wt(a, r)), (e.ref = t.ref), (e.return = t), (t.child = e));
}
function wf(e, t, n, r, l) {
  if (e !== null) {
    var a = e.memoizedProps;
    if ($r(a, r) && e.ref === t.ref)
      if (((Ne = !1), (t.pendingProps = r = a), (e.lanes & l) !== 0)) e.flags & 131072 && (Ne = !0);
      else return ((t.lanes = e.lanes), Ct(e, t, l));
  }
  return hi(e, t, n, r, l);
}
function kf(e, t, n) {
  var r = t.pendingProps,
    l = r.children,
    a = e !== null ? e.memoizedState : null;
  if (r.mode === 'hidden')
    if (!(t.mode & 1))
      ((t.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }),
        F(In, Te),
        (Te |= n));
    else {
      if (!(n & 1073741824))
        return (
          (e = a !== null ? a.baseLanes | n : n),
          (t.lanes = t.childLanes = 1073741824),
          (t.memoizedState = { baseLanes: e, cachePool: null, transitions: null }),
          (t.updateQueue = null),
          F(In, Te),
          (Te |= e),
          null
        );
      ((t.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }),
        (r = a !== null ? a.baseLanes : n),
        F(In, Te),
        (Te |= r));
    }
  else
    (a !== null ? ((r = a.baseLanes | n), (t.memoizedState = null)) : (r = n),
      F(In, Te),
      (Te |= r));
  return (xe(e, t, l, n), t.child);
}
function jf(e, t) {
  var n = t.ref;
  ((e === null && n !== null) || (e !== null && e.ref !== n)) &&
    ((t.flags |= 512), (t.flags |= 2097152));
}
function hi(e, t, n, r, l) {
  var a = Ee(n) ? cn : ye.current;
  return (
    (a = Hn(t, a)),
    Fn(t, l),
    (n = ks(e, t, n, r, a, l)),
    (r = js()),
    e !== null && !Ne
      ? ((t.updateQueue = e.updateQueue), (t.flags &= -2053), (e.lanes &= ~l), Ct(e, t, l))
      : (H && r && us(t), (t.flags |= 1), xe(e, t, n, l), t.child)
  );
}
function tc(e, t, n, r, l) {
  if (Ee(n)) {
    var a = !0;
    oa(t);
  } else a = !1;
  if ((Fn(t, l), t.stateNode === null)) (Wl(e, t), vf(t, n, r), fi(t, n, r, l), (r = !0));
  else if (e === null) {
    var o = t.stateNode,
      s = t.memoizedProps;
    o.props = s;
    var u = o.context,
      c = n.contextType;
    typeof c == 'object' && c !== null
      ? (c = He(c))
      : ((c = Ee(n) ? cn : ye.current), (c = Hn(t, c)));
    var m = n.getDerivedStateFromProps,
      d = typeof m == 'function' || typeof o.getSnapshotBeforeUpdate == 'function';
    (d ||
      (typeof o.UNSAFE_componentWillReceiveProps != 'function' &&
        typeof o.componentWillReceiveProps != 'function') ||
      ((s !== r || u !== c) && Yu(t, o, r, c)),
      (Rt = !1));
    var f = t.memoizedState;
    ((o.state = f),
      da(t, r, o, l),
      (u = t.memoizedState),
      s !== r || f !== u || Ce.current || Rt
        ? (typeof m == 'function' && (di(t, n, m, r), (u = t.memoizedState)),
          (s = Rt || qu(t, n, s, r, f, u, c))
            ? (d ||
                (typeof o.UNSAFE_componentWillMount != 'function' &&
                  typeof o.componentWillMount != 'function') ||
                (typeof o.componentWillMount == 'function' && o.componentWillMount(),
                typeof o.UNSAFE_componentWillMount == 'function' && o.UNSAFE_componentWillMount()),
              typeof o.componentDidMount == 'function' && (t.flags |= 4194308))
            : (typeof o.componentDidMount == 'function' && (t.flags |= 4194308),
              (t.memoizedProps = r),
              (t.memoizedState = u)),
          (o.props = r),
          (o.state = u),
          (o.context = c),
          (r = s))
        : (typeof o.componentDidMount == 'function' && (t.flags |= 4194308), (r = !1)));
  } else {
    ((o = t.stateNode),
      Yd(e, t),
      (s = t.memoizedProps),
      (c = t.type === t.elementType ? s : qe(t.type, s)),
      (o.props = c),
      (d = t.pendingProps),
      (f = o.context),
      (u = n.contextType),
      typeof u == 'object' && u !== null
        ? (u = He(u))
        : ((u = Ee(n) ? cn : ye.current), (u = Hn(t, u))));
    var v = n.getDerivedStateFromProps;
    ((m = typeof v == 'function' || typeof o.getSnapshotBeforeUpdate == 'function') ||
      (typeof o.UNSAFE_componentWillReceiveProps != 'function' &&
        typeof o.componentWillReceiveProps != 'function') ||
      ((s !== d || f !== u) && Yu(t, o, r, u)),
      (Rt = !1),
      (f = t.memoizedState),
      (o.state = f),
      da(t, r, o, l));
    var k = t.memoizedState;
    s !== d || f !== k || Ce.current || Rt
      ? (typeof v == 'function' && (di(t, n, v, r), (k = t.memoizedState)),
        (c = Rt || qu(t, n, c, r, f, k, u) || !1)
          ? (m ||
              (typeof o.UNSAFE_componentWillUpdate != 'function' &&
                typeof o.componentWillUpdate != 'function') ||
              (typeof o.componentWillUpdate == 'function' && o.componentWillUpdate(r, k, u),
              typeof o.UNSAFE_componentWillUpdate == 'function' &&
                o.UNSAFE_componentWillUpdate(r, k, u)),
            typeof o.componentDidUpdate == 'function' && (t.flags |= 4),
            typeof o.getSnapshotBeforeUpdate == 'function' && (t.flags |= 1024))
          : (typeof o.componentDidUpdate != 'function' ||
              (s === e.memoizedProps && f === e.memoizedState) ||
              (t.flags |= 4),
            typeof o.getSnapshotBeforeUpdate != 'function' ||
              (s === e.memoizedProps && f === e.memoizedState) ||
              (t.flags |= 1024),
            (t.memoizedProps = r),
            (t.memoizedState = k)),
        (o.props = r),
        (o.state = k),
        (o.context = u),
        (r = c))
      : (typeof o.componentDidUpdate != 'function' ||
          (s === e.memoizedProps && f === e.memoizedState) ||
          (t.flags |= 4),
        typeof o.getSnapshotBeforeUpdate != 'function' ||
          (s === e.memoizedProps && f === e.memoizedState) ||
          (t.flags |= 1024),
        (r = !1));
  }
  return mi(e, t, n, r, a, l);
}
function mi(e, t, n, r, l, a) {
  jf(e, t);
  var o = (t.flags & 128) !== 0;
  if (!r && !o) return (l && Fu(t, n, !1), Ct(e, t, a));
  ((r = t.stateNode), (ag.current = t));
  var s = o && typeof n.getDerivedStateFromError != 'function' ? null : r.render();
  return (
    (t.flags |= 1),
    e !== null && o
      ? ((t.child = Qn(t, e.child, null, a)), (t.child = Qn(t, null, s, a)))
      : xe(e, t, s, a),
    (t.memoizedState = r.state),
    l && Fu(t, n, !0),
    t.child
  );
}
function Sf(e) {
  var t = e.stateNode;
  (t.pendingContext
    ? Bu(e, t.pendingContext, t.pendingContext !== t.context)
    : t.context && Bu(e, t.context, !1),
    vs(e, t.containerInfo));
}
function nc(e, t, n, r, l) {
  return (Wn(), ds(l), (t.flags |= 256), xe(e, t, n, r), t.child);
}
var gi = { dehydrated: null, treeContext: null, retryLane: 0 };
function vi(e) {
  return { baseLanes: e, cachePool: null, transitions: null };
}
function Nf(e, t, n) {
  var r = t.pendingProps,
    l = W.current,
    a = !1,
    o = (t.flags & 128) !== 0,
    s;
  if (
    ((s = o) || (s = e !== null && e.memoizedState === null ? !1 : (l & 2) !== 0),
    s ? ((a = !0), (t.flags &= -129)) : (e === null || e.memoizedState !== null) && (l |= 1),
    F(W, l & 1),
    e === null)
  )
    return (
      ui(t),
      (e = t.memoizedState),
      e !== null && ((e = e.dehydrated), e !== null)
        ? (t.mode & 1 ? (e.data === '$!' ? (t.lanes = 8) : (t.lanes = 1073741824)) : (t.lanes = 1),
          null)
        : ((o = r.children),
          (e = r.fallback),
          a
            ? ((r = t.mode),
              (a = t.child),
              (o = { mode: 'hidden', children: o }),
              !(r & 1) && a !== null
                ? ((a.childLanes = 0), (a.pendingProps = o))
                : (a = Ia(o, r, 0, null)),
              (e = sn(e, r, n, null)),
              (a.return = t),
              (e.return = t),
              (a.sibling = e),
              (t.child = a),
              (t.child.memoizedState = vi(n)),
              (t.memoizedState = gi),
              e)
            : Cs(t, o))
    );
  if (((l = e.memoizedState), l !== null && ((s = l.dehydrated), s !== null)))
    return og(e, t, o, r, s, l, n);
  if (a) {
    ((a = r.fallback), (o = t.mode), (l = e.child), (s = l.sibling));
    var u = { mode: 'hidden', children: r.children };
    return (
      !(o & 1) && t.child !== l
        ? ((r = t.child), (r.childLanes = 0), (r.pendingProps = u), (t.deletions = null))
        : ((r = Wt(l, u)), (r.subtreeFlags = l.subtreeFlags & 14680064)),
      s !== null ? (a = Wt(s, a)) : ((a = sn(a, o, n, null)), (a.flags |= 2)),
      (a.return = t),
      (r.return = t),
      (r.sibling = a),
      (t.child = r),
      (r = a),
      (a = t.child),
      (o = e.child.memoizedState),
      (o =
        o === null
          ? vi(n)
          : { baseLanes: o.baseLanes | n, cachePool: null, transitions: o.transitions }),
      (a.memoizedState = o),
      (a.childLanes = e.childLanes & ~n),
      (t.memoizedState = gi),
      r
    );
  }
  return (
    (a = e.child),
    (e = a.sibling),
    (r = Wt(a, { mode: 'visible', children: r.children })),
    !(t.mode & 1) && (r.lanes = n),
    (r.return = t),
    (r.sibling = null),
    e !== null &&
      ((n = t.deletions), n === null ? ((t.deletions = [e]), (t.flags |= 16)) : n.push(e)),
    (t.child = r),
    (t.memoizedState = null),
    r
  );
}
function Cs(e, t) {
  return (
    (t = Ia({ mode: 'visible', children: t }, e.mode, 0, null)),
    (t.return = e),
    (e.child = t)
  );
}
function Tl(e, t, n, r) {
  return (
    r !== null && ds(r),
    Qn(t, e.child, null, n),
    (e = Cs(t, t.pendingProps.children)),
    (e.flags |= 2),
    (t.memoizedState = null),
    e
  );
}
function og(e, t, n, r, l, a, o) {
  if (n)
    return t.flags & 256
      ? ((t.flags &= -257), (r = So(Error(C(422)))), Tl(e, t, o, r))
      : t.memoizedState !== null
        ? ((t.child = e.child), (t.flags |= 128), null)
        : ((a = r.fallback),
          (l = t.mode),
          (r = Ia({ mode: 'visible', children: r.children }, l, 0, null)),
          (a = sn(a, l, o, null)),
          (a.flags |= 2),
          (r.return = t),
          (a.return = t),
          (r.sibling = a),
          (t.child = r),
          t.mode & 1 && Qn(t, e.child, null, o),
          (t.child.memoizedState = vi(o)),
          (t.memoizedState = gi),
          a);
  if (!(t.mode & 1)) return Tl(e, t, o, null);
  if (l.data === '$!') {
    if (((r = l.nextSibling && l.nextSibling.dataset), r)) var s = r.dgst;
    return ((r = s), (a = Error(C(419))), (r = So(a, r, void 0)), Tl(e, t, o, r));
  }
  if (((s = (o & e.childLanes) !== 0), Ne || s)) {
    if (((r = ue), r !== null)) {
      switch (o & -o) {
        case 4:
          l = 2;
          break;
        case 16:
          l = 8;
          break;
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          l = 32;
          break;
        case 536870912:
          l = 268435456;
          break;
        default:
          l = 0;
      }
      ((l = l & (r.suspendedLanes | o) ? 0 : l),
        l !== 0 && l !== a.retryLane && ((a.retryLane = l), Nt(e, l), Xe(r, e, l, -1)));
    }
    return (Rs(), (r = So(Error(C(421)))), Tl(e, t, o, r));
  }
  return l.data === '$?'
    ? ((t.flags |= 128), (t.child = e.child), (t = xg.bind(null, e)), (l._reactRetry = t), null)
    : ((e = a.treeContext),
      (Le = $t(l.nextSibling)),
      (Re = t),
      (H = !0),
      (Je = null),
      e !== null &&
        ((Be[Fe++] = xt),
        (Be[Fe++] = wt),
        (Be[Fe++] = dn),
        (xt = e.id),
        (wt = e.overflow),
        (dn = t)),
      (t = Cs(t, r.children)),
      (t.flags |= 4096),
      t);
}
function rc(e, t, n) {
  e.lanes |= t;
  var r = e.alternate;
  (r !== null && (r.lanes |= t), ci(e.return, t, n));
}
function No(e, t, n, r, l) {
  var a = e.memoizedState;
  a === null
    ? (e.memoizedState = {
        isBackwards: t,
        rendering: null,
        renderingStartTime: 0,
        last: r,
        tail: n,
        tailMode: l,
      })
    : ((a.isBackwards = t),
      (a.rendering = null),
      (a.renderingStartTime = 0),
      (a.last = r),
      (a.tail = n),
      (a.tailMode = l));
}
function Cf(e, t, n) {
  var r = t.pendingProps,
    l = r.revealOrder,
    a = r.tail;
  if ((xe(e, t, r.children, n), (r = W.current), r & 2)) ((r = (r & 1) | 2), (t.flags |= 128));
  else {
    if (e !== null && e.flags & 128)
      e: for (e = t.child; e !== null;) {
        if (e.tag === 13) e.memoizedState !== null && rc(e, n, t);
        else if (e.tag === 19) rc(e, n, t);
        else if (e.child !== null) {
          ((e.child.return = e), (e = e.child));
          continue;
        }
        if (e === t) break e;
        for (; e.sibling === null;) {
          if (e.return === null || e.return === t) break e;
          e = e.return;
        }
        ((e.sibling.return = e.return), (e = e.sibling));
      }
    r &= 1;
  }
  if ((F(W, r), !(t.mode & 1))) t.memoizedState = null;
  else
    switch (l) {
      case 'forwards':
        for (n = t.child, l = null; n !== null;)
          ((e = n.alternate), e !== null && fa(e) === null && (l = n), (n = n.sibling));
        ((n = l),
          n === null ? ((l = t.child), (t.child = null)) : ((l = n.sibling), (n.sibling = null)),
          No(t, !1, l, n, a));
        break;
      case 'backwards':
        for (n = null, l = t.child, t.child = null; l !== null;) {
          if (((e = l.alternate), e !== null && fa(e) === null)) {
            t.child = l;
            break;
          }
          ((e = l.sibling), (l.sibling = n), (n = l), (l = e));
        }
        No(t, !0, n, null, a);
        break;
      case 'together':
        No(t, !1, null, null, void 0);
        break;
      default:
        t.memoizedState = null;
    }
  return t.child;
}
function Wl(e, t) {
  !(t.mode & 1) && e !== null && ((e.alternate = null), (t.alternate = null), (t.flags |= 2));
}
function Ct(e, t, n) {
  if ((e !== null && (t.dependencies = e.dependencies), (pn |= t.lanes), !(n & t.childLanes)))
    return null;
  if (e !== null && t.child !== e.child) throw Error(C(153));
  if (t.child !== null) {
    for (e = t.child, n = Wt(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;)
      ((e = e.sibling), (n = n.sibling = Wt(e, e.pendingProps)), (n.return = t));
    n.sibling = null;
  }
  return t.child;
}
function ig(e, t, n) {
  switch (t.tag) {
    case 3:
      (Sf(t), Wn());
      break;
    case 5:
      Jd(t);
      break;
    case 1:
      Ee(t.type) && oa(t);
      break;
    case 4:
      vs(t, t.stateNode.containerInfo);
      break;
    case 10:
      var r = t.type._context,
        l = t.memoizedProps.value;
      (F(ua, r._currentValue), (r._currentValue = l));
      break;
    case 13:
      if (((r = t.memoizedState), r !== null))
        return r.dehydrated !== null
          ? (F(W, W.current & 1), (t.flags |= 128), null)
          : n & t.child.childLanes
            ? Nf(e, t, n)
            : (F(W, W.current & 1), (e = Ct(e, t, n)), e !== null ? e.sibling : null);
      F(W, W.current & 1);
      break;
    case 19:
      if (((r = (n & t.childLanes) !== 0), e.flags & 128)) {
        if (r) return Cf(e, t, n);
        t.flags |= 128;
      }
      if (
        ((l = t.memoizedState),
        l !== null && ((l.rendering = null), (l.tail = null), (l.lastEffect = null)),
        F(W, W.current),
        r)
      )
        break;
      return null;
    case 22:
    case 23:
      return ((t.lanes = 0), kf(e, t, n));
  }
  return Ct(e, t, n);
}
var Ef, yi, _f, Pf;
Ef = function (e, t) {
  for (var n = t.child; n !== null;) {
    if (n.tag === 5 || n.tag === 6) e.appendChild(n.stateNode);
    else if (n.tag !== 4 && n.child !== null) {
      ((n.child.return = n), (n = n.child));
      continue;
    }
    if (n === t) break;
    for (; n.sibling === null;) {
      if (n.return === null || n.return === t) return;
      n = n.return;
    }
    ((n.sibling.return = n.return), (n = n.sibling));
  }
};
yi = function () {};
_f = function (e, t, n, r) {
  var l = e.memoizedProps;
  if (l !== r) {
    ((e = t.stateNode), an(st.current));
    var a = null;
    switch (n) {
      case 'input':
        ((l = Fo(e, l)), (r = Fo(e, r)), (a = []));
        break;
      case 'select':
        ((l = q({}, l, { value: void 0 })), (r = q({}, r, { value: void 0 })), (a = []));
        break;
      case 'textarea':
        ((l = Vo(e, l)), (r = Vo(e, r)), (a = []));
        break;
      default:
        typeof l.onClick != 'function' && typeof r.onClick == 'function' && (e.onclick = la);
    }
    Wo(n, r);
    var o;
    n = null;
    for (c in l)
      if (!r.hasOwnProperty(c) && l.hasOwnProperty(c) && l[c] != null)
        if (c === 'style') {
          var s = l[c];
          for (o in s) s.hasOwnProperty(o) && (n || (n = {}), (n[o] = ''));
        } else
          c !== 'dangerouslySetInnerHTML' &&
            c !== 'children' &&
            c !== 'suppressContentEditableWarning' &&
            c !== 'suppressHydrationWarning' &&
            c !== 'autoFocus' &&
            (Or.hasOwnProperty(c) ? a || (a = []) : (a = a || []).push(c, null));
    for (c in r) {
      var u = r[c];
      if (
        ((s = l != null ? l[c] : void 0),
        r.hasOwnProperty(c) && u !== s && (u != null || s != null))
      )
        if (c === 'style')
          if (s) {
            for (o in s)
              !s.hasOwnProperty(o) || (u && u.hasOwnProperty(o)) || (n || (n = {}), (n[o] = ''));
            for (o in u) u.hasOwnProperty(o) && s[o] !== u[o] && (n || (n = {}), (n[o] = u[o]));
          } else (n || (a || (a = []), a.push(c, n)), (n = u));
        else
          c === 'dangerouslySetInnerHTML'
            ? ((u = u ? u.__html : void 0),
              (s = s ? s.__html : void 0),
              u != null && s !== u && (a = a || []).push(c, u))
            : c === 'children'
              ? (typeof u != 'string' && typeof u != 'number') || (a = a || []).push(c, '' + u)
              : c !== 'suppressContentEditableWarning' &&
                c !== 'suppressHydrationWarning' &&
                (Or.hasOwnProperty(c)
                  ? (u != null && c === 'onScroll' && U('scroll', e), a || s === u || (a = []))
                  : (a = a || []).push(c, u));
    }
    n && (a = a || []).push('style', n);
    var c = a;
    (t.updateQueue = c) && (t.flags |= 4);
  }
};
Pf = function (e, t, n, r) {
  n !== r && (t.flags |= 4);
};
function vr(e, t) {
  if (!H)
    switch (e.tailMode) {
      case 'hidden':
        t = e.tail;
        for (var n = null; t !== null;) (t.alternate !== null && (n = t), (t = t.sibling));
        n === null ? (e.tail = null) : (n.sibling = null);
        break;
      case 'collapsed':
        n = e.tail;
        for (var r = null; n !== null;) (n.alternate !== null && (r = n), (n = n.sibling));
        r === null
          ? t || e.tail === null
            ? (e.tail = null)
            : (e.tail.sibling = null)
          : (r.sibling = null);
    }
}
function me(e) {
  var t = e.alternate !== null && e.alternate.child === e.child,
    n = 0,
    r = 0;
  if (t)
    for (var l = e.child; l !== null;)
      ((n |= l.lanes | l.childLanes),
        (r |= l.subtreeFlags & 14680064),
        (r |= l.flags & 14680064),
        (l.return = e),
        (l = l.sibling));
  else
    for (l = e.child; l !== null;)
      ((n |= l.lanes | l.childLanes),
        (r |= l.subtreeFlags),
        (r |= l.flags),
        (l.return = e),
        (l = l.sibling));
  return ((e.subtreeFlags |= r), (e.childLanes = n), t);
}
function sg(e, t, n) {
  var r = t.pendingProps;
  switch ((cs(t), t.tag)) {
    case 2:
    case 16:
    case 15:
    case 0:
    case 11:
    case 7:
    case 8:
    case 12:
    case 9:
    case 14:
      return (me(t), null);
    case 1:
      return (Ee(t.type) && aa(), me(t), null);
    case 3:
      return (
        (r = t.stateNode),
        Kn(),
        V(Ce),
        V(ye),
        xs(),
        r.pendingContext && ((r.context = r.pendingContext), (r.pendingContext = null)),
        (e === null || e.child === null) &&
          (_l(t)
            ? (t.flags |= 4)
            : e === null ||
              (e.memoizedState.isDehydrated && !(t.flags & 256)) ||
              ((t.flags |= 1024), Je !== null && (Ei(Je), (Je = null)))),
        yi(e, t),
        me(t),
        null
      );
    case 5:
      ys(t);
      var l = an(Qr.current);
      if (((n = t.type), e !== null && t.stateNode != null))
        (_f(e, t, n, r, l), e.ref !== t.ref && ((t.flags |= 512), (t.flags |= 2097152)));
      else {
        if (!r) {
          if (t.stateNode === null) throw Error(C(166));
          return (me(t), null);
        }
        if (((e = an(st.current)), _l(t))) {
          ((r = t.stateNode), (n = t.type));
          var a = t.memoizedProps;
          switch (((r[at] = t), (r[Hr] = a), (e = (t.mode & 1) !== 0), n)) {
            case 'dialog':
              (U('cancel', r), U('close', r));
              break;
            case 'iframe':
            case 'object':
            case 'embed':
              U('load', r);
              break;
            case 'video':
            case 'audio':
              for (l = 0; l < Sr.length; l++) U(Sr[l], r);
              break;
            case 'source':
              U('error', r);
              break;
            case 'img':
            case 'image':
            case 'link':
              (U('error', r), U('load', r));
              break;
            case 'details':
              U('toggle', r);
              break;
            case 'input':
              (fu(r, a), U('invalid', r));
              break;
            case 'select':
              ((r._wrapperState = { wasMultiple: !!a.multiple }), U('invalid', r));
              break;
            case 'textarea':
              (hu(r, a), U('invalid', r));
          }
          (Wo(n, a), (l = null));
          for (var o in a)
            if (a.hasOwnProperty(o)) {
              var s = a[o];
              o === 'children'
                ? typeof s == 'string'
                  ? r.textContent !== s &&
                    (a.suppressHydrationWarning !== !0 && El(r.textContent, s, e),
                    (l = ['children', s]))
                  : typeof s == 'number' &&
                    r.textContent !== '' + s &&
                    (a.suppressHydrationWarning !== !0 && El(r.textContent, s, e),
                    (l = ['children', '' + s]))
                : Or.hasOwnProperty(o) && s != null && o === 'onScroll' && U('scroll', r);
            }
          switch (n) {
            case 'input':
              (yl(r), pu(r, a, !0));
              break;
            case 'textarea':
              (yl(r), mu(r));
              break;
            case 'select':
            case 'option':
              break;
            default:
              typeof a.onClick == 'function' && (r.onclick = la);
          }
          ((r = l), (t.updateQueue = r), r !== null && (t.flags |= 4));
        } else {
          ((o = l.nodeType === 9 ? l : l.ownerDocument),
            e === 'http://www.w3.org/1999/xhtml' && (e = td(n)),
            e === 'http://www.w3.org/1999/xhtml'
              ? n === 'script'
                ? ((e = o.createElement('div')),
                  (e.innerHTML = '<script><\/script>'),
                  (e = e.removeChild(e.firstChild)))
                : typeof r.is == 'string'
                  ? (e = o.createElement(n, { is: r.is }))
                  : ((e = o.createElement(n)),
                    n === 'select' &&
                      ((o = e), r.multiple ? (o.multiple = !0) : r.size && (o.size = r.size)))
              : (e = o.createElementNS(e, n)),
            (e[at] = t),
            (e[Hr] = r),
            Ef(e, t, !1, !1),
            (t.stateNode = e));
          e: {
            switch (((o = Qo(n, r)), n)) {
              case 'dialog':
                (U('cancel', e), U('close', e), (l = r));
                break;
              case 'iframe':
              case 'object':
              case 'embed':
                (U('load', e), (l = r));
                break;
              case 'video':
              case 'audio':
                for (l = 0; l < Sr.length; l++) U(Sr[l], e);
                l = r;
                break;
              case 'source':
                (U('error', e), (l = r));
                break;
              case 'img':
              case 'image':
              case 'link':
                (U('error', e), U('load', e), (l = r));
                break;
              case 'details':
                (U('toggle', e), (l = r));
                break;
              case 'input':
                (fu(e, r), (l = Fo(e, r)), U('invalid', e));
                break;
              case 'option':
                l = r;
                break;
              case 'select':
                ((e._wrapperState = { wasMultiple: !!r.multiple }),
                  (l = q({}, r, { value: void 0 })),
                  U('invalid', e));
                break;
              case 'textarea':
                (hu(e, r), (l = Vo(e, r)), U('invalid', e));
                break;
              default:
                l = r;
            }
            (Wo(n, l), (s = l));
            for (a in s)
              if (s.hasOwnProperty(a)) {
                var u = s[a];
                a === 'style'
                  ? ld(e, u)
                  : a === 'dangerouslySetInnerHTML'
                    ? ((u = u ? u.__html : void 0), u != null && nd(e, u))
                    : a === 'children'
                      ? typeof u == 'string'
                        ? (n !== 'textarea' || u !== '') && Ir(e, u)
                        : typeof u == 'number' && Ir(e, '' + u)
                      : a !== 'suppressContentEditableWarning' &&
                        a !== 'suppressHydrationWarning' &&
                        a !== 'autoFocus' &&
                        (Or.hasOwnProperty(a)
                          ? u != null && a === 'onScroll' && U('scroll', e)
                          : u != null && Yi(e, a, u, o));
              }
            switch (n) {
              case 'input':
                (yl(e), pu(e, r, !1));
                break;
              case 'textarea':
                (yl(e), mu(e));
                break;
              case 'option':
                r.value != null && e.setAttribute('value', '' + Kt(r.value));
                break;
              case 'select':
                ((e.multiple = !!r.multiple),
                  (a = r.value),
                  a != null
                    ? An(e, !!r.multiple, a, !1)
                    : r.defaultValue != null && An(e, !!r.multiple, r.defaultValue, !0));
                break;
              default:
                typeof l.onClick == 'function' && (e.onclick = la);
            }
            switch (n) {
              case 'button':
              case 'input':
              case 'select':
              case 'textarea':
                r = !!r.autoFocus;
                break e;
              case 'img':
                r = !0;
                break e;
              default:
                r = !1;
            }
          }
          r && (t.flags |= 4);
        }
        t.ref !== null && ((t.flags |= 512), (t.flags |= 2097152));
      }
      return (me(t), null);
    case 6:
      if (e && t.stateNode != null) Pf(e, t, e.memoizedProps, r);
      else {
        if (typeof r != 'string' && t.stateNode === null) throw Error(C(166));
        if (((n = an(Qr.current)), an(st.current), _l(t))) {
          if (
            ((r = t.stateNode),
            (n = t.memoizedProps),
            (r[at] = t),
            (a = r.nodeValue !== n) && ((e = Re), e !== null))
          )
            switch (e.tag) {
              case 3:
                El(r.nodeValue, n, (e.mode & 1) !== 0);
                break;
              case 5:
                e.memoizedProps.suppressHydrationWarning !== !0 &&
                  El(r.nodeValue, n, (e.mode & 1) !== 0);
            }
          a && (t.flags |= 4);
        } else
          ((r = (n.nodeType === 9 ? n : n.ownerDocument).createTextNode(r)),
            (r[at] = t),
            (t.stateNode = r));
      }
      return (me(t), null);
    case 13:
      if (
        (V(W),
        (r = t.memoizedState),
        e === null || (e.memoizedState !== null && e.memoizedState.dehydrated !== null))
      ) {
        if (H && Le !== null && t.mode & 1 && !(t.flags & 128))
          (Wd(), Wn(), (t.flags |= 98560), (a = !1));
        else if (((a = _l(t)), r !== null && r.dehydrated !== null)) {
          if (e === null) {
            if (!a) throw Error(C(318));
            if (((a = t.memoizedState), (a = a !== null ? a.dehydrated : null), !a))
              throw Error(C(317));
            a[at] = t;
          } else (Wn(), !(t.flags & 128) && (t.memoizedState = null), (t.flags |= 4));
          (me(t), (a = !1));
        } else (Je !== null && (Ei(Je), (Je = null)), (a = !0));
        if (!a) return t.flags & 65536 ? t : null;
      }
      return t.flags & 128
        ? ((t.lanes = n), t)
        : ((r = r !== null),
          r !== (e !== null && e.memoizedState !== null) &&
            r &&
            ((t.child.flags |= 8192),
            t.mode & 1 && (e === null || W.current & 1 ? oe === 0 && (oe = 3) : Rs())),
          t.updateQueue !== null && (t.flags |= 4),
          me(t),
          null);
    case 4:
      return (Kn(), yi(e, t), e === null && Ur(t.stateNode.containerInfo), me(t), null);
    case 10:
      return (hs(t.type._context), me(t), null);
    case 17:
      return (Ee(t.type) && aa(), me(t), null);
    case 19:
      if ((V(W), (a = t.memoizedState), a === null)) return (me(t), null);
      if (((r = (t.flags & 128) !== 0), (o = a.rendering), o === null))
        if (r) vr(a, !1);
        else {
          if (oe !== 0 || (e !== null && e.flags & 128))
            for (e = t.child; e !== null;) {
              if (((o = fa(e)), o !== null)) {
                for (
                  t.flags |= 128,
                    vr(a, !1),
                    r = o.updateQueue,
                    r !== null && ((t.updateQueue = r), (t.flags |= 4)),
                    t.subtreeFlags = 0,
                    r = n,
                    n = t.child;
                  n !== null;
                )
                  ((a = n),
                    (e = r),
                    (a.flags &= 14680066),
                    (o = a.alternate),
                    o === null
                      ? ((a.childLanes = 0),
                        (a.lanes = e),
                        (a.child = null),
                        (a.subtreeFlags = 0),
                        (a.memoizedProps = null),
                        (a.memoizedState = null),
                        (a.updateQueue = null),
                        (a.dependencies = null),
                        (a.stateNode = null))
                      : ((a.childLanes = o.childLanes),
                        (a.lanes = o.lanes),
                        (a.child = o.child),
                        (a.subtreeFlags = 0),
                        (a.deletions = null),
                        (a.memoizedProps = o.memoizedProps),
                        (a.memoizedState = o.memoizedState),
                        (a.updateQueue = o.updateQueue),
                        (a.type = o.type),
                        (e = o.dependencies),
                        (a.dependencies =
                          e === null ? null : { lanes: e.lanes, firstContext: e.firstContext })),
                    (n = n.sibling));
                return (F(W, (W.current & 1) | 2), t.child);
              }
              e = e.sibling;
            }
          a.tail !== null &&
            G() > Yn &&
            ((t.flags |= 128), (r = !0), vr(a, !1), (t.lanes = 4194304));
        }
      else {
        if (!r)
          if (((e = fa(o)), e !== null)) {
            if (
              ((t.flags |= 128),
              (r = !0),
              (n = e.updateQueue),
              n !== null && ((t.updateQueue = n), (t.flags |= 4)),
              vr(a, !0),
              a.tail === null && a.tailMode === 'hidden' && !o.alternate && !H)
            )
              return (me(t), null);
          } else
            2 * G() - a.renderingStartTime > Yn &&
              n !== 1073741824 &&
              ((t.flags |= 128), (r = !0), vr(a, !1), (t.lanes = 4194304));
        a.isBackwards
          ? ((o.sibling = t.child), (t.child = o))
          : ((n = a.last), n !== null ? (n.sibling = o) : (t.child = o), (a.last = o));
      }
      return a.tail !== null
        ? ((t = a.tail),
          (a.rendering = t),
          (a.tail = t.sibling),
          (a.renderingStartTime = G()),
          (t.sibling = null),
          (n = W.current),
          F(W, r ? (n & 1) | 2 : n & 1),
          t)
        : (me(t), null);
    case 22:
    case 23:
      return (
        Ls(),
        (r = t.memoizedState !== null),
        e !== null && (e.memoizedState !== null) !== r && (t.flags |= 8192),
        r && t.mode & 1
          ? Te & 1073741824 && (me(t), t.subtreeFlags & 6 && (t.flags |= 8192))
          : me(t),
        null
      );
    case 24:
      return null;
    case 25:
      return null;
  }
  throw Error(C(156, t.tag));
}
function ug(e, t) {
  switch ((cs(t), t.tag)) {
    case 1:
      return (
        Ee(t.type) && aa(),
        (e = t.flags),
        e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
      );
    case 3:
      return (
        Kn(),
        V(Ce),
        V(ye),
        xs(),
        (e = t.flags),
        e & 65536 && !(e & 128) ? ((t.flags = (e & -65537) | 128), t) : null
      );
    case 5:
      return (ys(t), null);
    case 13:
      if ((V(W), (e = t.memoizedState), e !== null && e.dehydrated !== null)) {
        if (t.alternate === null) throw Error(C(340));
        Wn();
      }
      return ((e = t.flags), e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null);
    case 19:
      return (V(W), null);
    case 4:
      return (Kn(), null);
    case 10:
      return (hs(t.type._context), null);
    case 22:
    case 23:
      return (Ls(), null);
    case 24:
      return null;
    default:
      return null;
  }
}
var Ll = !1,
  ve = !1,
  cg = typeof WeakSet == 'function' ? WeakSet : Set,
  R = null;
function On(e, t) {
  var n = e.ref;
  if (n !== null)
    if (typeof n == 'function')
      try {
        n(null);
      } catch (r) {
        Y(e, t, r);
      }
    else n.current = null;
}
function xi(e, t, n) {
  try {
    n();
  } catch (r) {
    Y(e, t, r);
  }
}
var lc = !1;
function dg(e, t) {
  if (((ni = ta), (e = bd()), ss(e))) {
    if ('selectionStart' in e) var n = { start: e.selectionStart, end: e.selectionEnd };
    else
      e: {
        n = ((n = e.ownerDocument) && n.defaultView) || window;
        var r = n.getSelection && n.getSelection();
        if (r && r.rangeCount !== 0) {
          n = r.anchorNode;
          var l = r.anchorOffset,
            a = r.focusNode;
          r = r.focusOffset;
          try {
            (n.nodeType, a.nodeType);
          } catch {
            n = null;
            break e;
          }
          var o = 0,
            s = -1,
            u = -1,
            c = 0,
            m = 0,
            d = e,
            f = null;
          t: for (;;) {
            for (
              var v;
              d !== n || (l !== 0 && d.nodeType !== 3) || (s = o + l),
                d !== a || (r !== 0 && d.nodeType !== 3) || (u = o + r),
                d.nodeType === 3 && (o += d.nodeValue.length),
                (v = d.firstChild) !== null;
            )
              ((f = d), (d = v));
            for (;;) {
              if (d === e) break t;
              if (
                (f === n && ++c === l && (s = o),
                f === a && ++m === r && (u = o),
                (v = d.nextSibling) !== null)
              )
                break;
              ((d = f), (f = d.parentNode));
            }
            d = v;
          }
          n = s === -1 || u === -1 ? null : { start: s, end: u };
        } else n = null;
      }
    n = n || { start: 0, end: 0 };
  } else n = null;
  for (ri = { focusedElem: e, selectionRange: n }, ta = !1, R = t; R !== null;)
    if (((t = R), (e = t.child), (t.subtreeFlags & 1028) !== 0 && e !== null))
      ((e.return = t), (R = e));
    else
      for (; R !== null;) {
        t = R;
        try {
          var k = t.alternate;
          if (t.flags & 1024)
            switch (t.tag) {
              case 0:
              case 11:
              case 15:
                break;
              case 1:
                if (k !== null) {
                  var w = k.memoizedProps,
                    j = k.memoizedState,
                    h = t.stateNode,
                    p = h.getSnapshotBeforeUpdate(t.elementType === t.type ? w : qe(t.type, w), j);
                  h.__reactInternalSnapshotBeforeUpdate = p;
                }
                break;
              case 3:
                var g = t.stateNode.containerInfo;
                g.nodeType === 1
                  ? (g.textContent = '')
                  : g.nodeType === 9 && g.documentElement && g.removeChild(g.documentElement);
                break;
              case 5:
              case 6:
              case 4:
              case 17:
                break;
              default:
                throw Error(C(163));
            }
        } catch (y) {
          Y(t, t.return, y);
        }
        if (((e = t.sibling), e !== null)) {
          ((e.return = t.return), (R = e));
          break;
        }
        R = t.return;
      }
  return ((k = lc), (lc = !1), k);
}
function Lr(e, t, n) {
  var r = t.updateQueue;
  if (((r = r !== null ? r.lastEffect : null), r !== null)) {
    var l = (r = r.next);
    do {
      if ((l.tag & e) === e) {
        var a = l.destroy;
        ((l.destroy = void 0), a !== void 0 && xi(t, n, a));
      }
      l = l.next;
    } while (l !== r);
  }
}
function Ma(e, t) {
  if (((t = t.updateQueue), (t = t !== null ? t.lastEffect : null), t !== null)) {
    var n = (t = t.next);
    do {
      if ((n.tag & e) === e) {
        var r = n.create;
        n.destroy = r();
      }
      n = n.next;
    } while (n !== t);
  }
}
function wi(e) {
  var t = e.ref;
  if (t !== null) {
    var n = e.stateNode;
    switch (e.tag) {
      case 5:
        e = n;
        break;
      default:
        e = n;
    }
    typeof t == 'function' ? t(e) : (t.current = e);
  }
}
function Tf(e) {
  var t = e.alternate;
  (t !== null && ((e.alternate = null), Tf(t)),
    (e.child = null),
    (e.deletions = null),
    (e.sibling = null),
    e.tag === 5 &&
      ((t = e.stateNode),
      t !== null && (delete t[at], delete t[Hr], delete t[oi], delete t[Km], delete t[qm])),
    (e.stateNode = null),
    (e.return = null),
    (e.dependencies = null),
    (e.memoizedProps = null),
    (e.memoizedState = null),
    (e.pendingProps = null),
    (e.stateNode = null),
    (e.updateQueue = null));
}
function Lf(e) {
  return e.tag === 5 || e.tag === 3 || e.tag === 4;
}
function ac(e) {
  e: for (;;) {
    for (; e.sibling === null;) {
      if (e.return === null || Lf(e.return)) return null;
      e = e.return;
    }
    for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
      if (e.flags & 2 || e.child === null || e.tag === 4) continue e;
      ((e.child.return = e), (e = e.child));
    }
    if (!(e.flags & 2)) return e.stateNode;
  }
}
function ki(e, t, n) {
  var r = e.tag;
  if (r === 5 || r === 6)
    ((e = e.stateNode),
      t
        ? n.nodeType === 8
          ? n.parentNode.insertBefore(e, t)
          : n.insertBefore(e, t)
        : (n.nodeType === 8
            ? ((t = n.parentNode), t.insertBefore(e, n))
            : ((t = n), t.appendChild(e)),
          (n = n._reactRootContainer),
          n != null || t.onclick !== null || (t.onclick = la)));
  else if (r !== 4 && ((e = e.child), e !== null))
    for (ki(e, t, n), e = e.sibling; e !== null;) (ki(e, t, n), (e = e.sibling));
}
function ji(e, t, n) {
  var r = e.tag;
  if (r === 5 || r === 6) ((e = e.stateNode), t ? n.insertBefore(e, t) : n.appendChild(e));
  else if (r !== 4 && ((e = e.child), e !== null))
    for (ji(e, t, n), e = e.sibling; e !== null;) (ji(e, t, n), (e = e.sibling));
}
var ce = null,
  Ye = !1;
function Pt(e, t, n) {
  for (n = n.child; n !== null;) (Rf(e, t, n), (n = n.sibling));
}
function Rf(e, t, n) {
  if (it && typeof it.onCommitFiberUnmount == 'function')
    try {
      it.onCommitFiberUnmount(Ca, n);
    } catch {}
  switch (n.tag) {
    case 5:
      ve || On(n, t);
    case 6:
      var r = ce,
        l = Ye;
      ((ce = null),
        Pt(e, t, n),
        (ce = r),
        (Ye = l),
        ce !== null &&
          (Ye
            ? ((e = ce),
              (n = n.stateNode),
              e.nodeType === 8 ? e.parentNode.removeChild(n) : e.removeChild(n))
            : ce.removeChild(n.stateNode)));
      break;
    case 18:
      ce !== null &&
        (Ye
          ? ((e = ce),
            (n = n.stateNode),
            e.nodeType === 8 ? vo(e.parentNode, n) : e.nodeType === 1 && vo(e, n),
            Br(e))
          : vo(ce, n.stateNode));
      break;
    case 4:
      ((r = ce),
        (l = Ye),
        (ce = n.stateNode.containerInfo),
        (Ye = !0),
        Pt(e, t, n),
        (ce = r),
        (Ye = l));
      break;
    case 0:
    case 11:
    case 14:
    case 15:
      if (!ve && ((r = n.updateQueue), r !== null && ((r = r.lastEffect), r !== null))) {
        l = r = r.next;
        do {
          var a = l,
            o = a.destroy;
          ((a = a.tag), o !== void 0 && (a & 2 || a & 4) && xi(n, t, o), (l = l.next));
        } while (l !== r);
      }
      Pt(e, t, n);
      break;
    case 1:
      if (!ve && (On(n, t), (r = n.stateNode), typeof r.componentWillUnmount == 'function'))
        try {
          ((r.props = n.memoizedProps), (r.state = n.memoizedState), r.componentWillUnmount());
        } catch (s) {
          Y(n, t, s);
        }
      Pt(e, t, n);
      break;
    case 21:
      Pt(e, t, n);
      break;
    case 22:
      n.mode & 1
        ? ((ve = (r = ve) || n.memoizedState !== null), Pt(e, t, n), (ve = r))
        : Pt(e, t, n);
      break;
    default:
      Pt(e, t, n);
  }
}
function oc(e) {
  var t = e.updateQueue;
  if (t !== null) {
    e.updateQueue = null;
    var n = e.stateNode;
    (n === null && (n = e.stateNode = new cg()),
      t.forEach(function (r) {
        var l = wg.bind(null, e, r);
        n.has(r) || (n.add(r), r.then(l, l));
      }));
  }
}
function Ke(e, t) {
  var n = t.deletions;
  if (n !== null)
    for (var r = 0; r < n.length; r++) {
      var l = n[r];
      try {
        var a = e,
          o = t,
          s = o;
        e: for (; s !== null;) {
          switch (s.tag) {
            case 5:
              ((ce = s.stateNode), (Ye = !1));
              break e;
            case 3:
              ((ce = s.stateNode.containerInfo), (Ye = !0));
              break e;
            case 4:
              ((ce = s.stateNode.containerInfo), (Ye = !0));
              break e;
          }
          s = s.return;
        }
        if (ce === null) throw Error(C(160));
        (Rf(a, o, l), (ce = null), (Ye = !1));
        var u = l.alternate;
        (u !== null && (u.return = null), (l.return = null));
      } catch (c) {
        Y(l, t, c);
      }
    }
  if (t.subtreeFlags & 12854) for (t = t.child; t !== null;) (bf(t, e), (t = t.sibling));
}
function bf(e, t) {
  var n = e.alternate,
    r = e.flags;
  switch (e.tag) {
    case 0:
    case 11:
    case 14:
    case 15:
      if ((Ke(t, e), rt(e), r & 4)) {
        try {
          (Lr(3, e, e.return), Ma(3, e));
        } catch (w) {
          Y(e, e.return, w);
        }
        try {
          Lr(5, e, e.return);
        } catch (w) {
          Y(e, e.return, w);
        }
      }
      break;
    case 1:
      (Ke(t, e), rt(e), r & 512 && n !== null && On(n, n.return));
      break;
    case 5:
      if ((Ke(t, e), rt(e), r & 512 && n !== null && On(n, n.return), e.flags & 32)) {
        var l = e.stateNode;
        try {
          Ir(l, '');
        } catch (w) {
          Y(e, e.return, w);
        }
      }
      if (r & 4 && ((l = e.stateNode), l != null)) {
        var a = e.memoizedProps,
          o = n !== null ? n.memoizedProps : a,
          s = e.type,
          u = e.updateQueue;
        if (((e.updateQueue = null), u !== null))
          try {
            (s === 'input' && a.type === 'radio' && a.name != null && Zc(l, a), Qo(s, o));
            var c = Qo(s, a);
            for (o = 0; o < u.length; o += 2) {
              var m = u[o],
                d = u[o + 1];
              m === 'style'
                ? ld(l, d)
                : m === 'dangerouslySetInnerHTML'
                  ? nd(l, d)
                  : m === 'children'
                    ? Ir(l, d)
                    : Yi(l, m, d, c);
            }
            switch (s) {
              case 'input':
                $o(l, a);
                break;
              case 'textarea':
                ed(l, a);
                break;
              case 'select':
                var f = l._wrapperState.wasMultiple;
                l._wrapperState.wasMultiple = !!a.multiple;
                var v = a.value;
                v != null
                  ? An(l, !!a.multiple, v, !1)
                  : f !== !!a.multiple &&
                    (a.defaultValue != null
                      ? An(l, !!a.multiple, a.defaultValue, !0)
                      : An(l, !!a.multiple, a.multiple ? [] : '', !1));
            }
            l[Hr] = a;
          } catch (w) {
            Y(e, e.return, w);
          }
      }
      break;
    case 6:
      if ((Ke(t, e), rt(e), r & 4)) {
        if (e.stateNode === null) throw Error(C(162));
        ((l = e.stateNode), (a = e.memoizedProps));
        try {
          l.nodeValue = a;
        } catch (w) {
          Y(e, e.return, w);
        }
      }
      break;
    case 3:
      if ((Ke(t, e), rt(e), r & 4 && n !== null && n.memoizedState.isDehydrated))
        try {
          Br(t.containerInfo);
        } catch (w) {
          Y(e, e.return, w);
        }
      break;
    case 4:
      (Ke(t, e), rt(e));
      break;
    case 13:
      (Ke(t, e),
        rt(e),
        (l = e.child),
        l.flags & 8192 &&
          ((a = l.memoizedState !== null),
          (l.stateNode.isHidden = a),
          !a || (l.alternate !== null && l.alternate.memoizedState !== null) || (Ps = G())),
        r & 4 && oc(e));
      break;
    case 22:
      if (
        ((m = n !== null && n.memoizedState !== null),
        e.mode & 1 ? ((ve = (c = ve) || m), Ke(t, e), (ve = c)) : Ke(t, e),
        rt(e),
        r & 8192)
      ) {
        if (((c = e.memoizedState !== null), (e.stateNode.isHidden = c) && !m && e.mode & 1))
          for (R = e, m = e.child; m !== null;) {
            for (d = R = m; R !== null;) {
              switch (((f = R), (v = f.child), f.tag)) {
                case 0:
                case 11:
                case 14:
                case 15:
                  Lr(4, f, f.return);
                  break;
                case 1:
                  On(f, f.return);
                  var k = f.stateNode;
                  if (typeof k.componentWillUnmount == 'function') {
                    ((r = f), (n = f.return));
                    try {
                      ((t = r),
                        (k.props = t.memoizedProps),
                        (k.state = t.memoizedState),
                        k.componentWillUnmount());
                    } catch (w) {
                      Y(r, n, w);
                    }
                  }
                  break;
                case 5:
                  On(f, f.return);
                  break;
                case 22:
                  if (f.memoizedState !== null) {
                    sc(d);
                    continue;
                  }
              }
              v !== null ? ((v.return = f), (R = v)) : sc(d);
            }
            m = m.sibling;
          }
        e: for (m = null, d = e; ;) {
          if (d.tag === 5) {
            if (m === null) {
              m = d;
              try {
                ((l = d.stateNode),
                  c
                    ? ((a = l.style),
                      typeof a.setProperty == 'function'
                        ? a.setProperty('display', 'none', 'important')
                        : (a.display = 'none'))
                    : ((s = d.stateNode),
                      (u = d.memoizedProps.style),
                      (o = u != null && u.hasOwnProperty('display') ? u.display : null),
                      (s.style.display = rd('display', o))));
              } catch (w) {
                Y(e, e.return, w);
              }
            }
          } else if (d.tag === 6) {
            if (m === null)
              try {
                d.stateNode.nodeValue = c ? '' : d.memoizedProps;
              } catch (w) {
                Y(e, e.return, w);
              }
          } else if (
            ((d.tag !== 22 && d.tag !== 23) || d.memoizedState === null || d === e) &&
            d.child !== null
          ) {
            ((d.child.return = d), (d = d.child));
            continue;
          }
          if (d === e) break e;
          for (; d.sibling === null;) {
            if (d.return === null || d.return === e) break e;
            (m === d && (m = null), (d = d.return));
          }
          (m === d && (m = null), (d.sibling.return = d.return), (d = d.sibling));
        }
      }
      break;
    case 19:
      (Ke(t, e), rt(e), r & 4 && oc(e));
      break;
    case 21:
      break;
    default:
      (Ke(t, e), rt(e));
  }
}
function rt(e) {
  var t = e.flags;
  if (t & 2) {
    try {
      e: {
        for (var n = e.return; n !== null;) {
          if (Lf(n)) {
            var r = n;
            break e;
          }
          n = n.return;
        }
        throw Error(C(160));
      }
      switch (r.tag) {
        case 5:
          var l = r.stateNode;
          r.flags & 32 && (Ir(l, ''), (r.flags &= -33));
          var a = ac(e);
          ji(e, a, l);
          break;
        case 3:
        case 4:
          var o = r.stateNode.containerInfo,
            s = ac(e);
          ki(e, s, o);
          break;
        default:
          throw Error(C(161));
      }
    } catch (u) {
      Y(e, e.return, u);
    }
    e.flags &= -3;
  }
  t & 4096 && (e.flags &= -4097);
}
function fg(e, t, n) {
  ((R = e), Mf(e));
}
function Mf(e, t, n) {
  for (var r = (e.mode & 1) !== 0; R !== null;) {
    var l = R,
      a = l.child;
    if (l.tag === 22 && r) {
      var o = l.memoizedState !== null || Ll;
      if (!o) {
        var s = l.alternate,
          u = (s !== null && s.memoizedState !== null) || ve;
        s = Ll;
        var c = ve;
        if (((Ll = o), (ve = u) && !c))
          for (R = l; R !== null;)
            ((o = R),
              (u = o.child),
              o.tag === 22 && o.memoizedState !== null
                ? uc(l)
                : u !== null
                  ? ((u.return = o), (R = u))
                  : uc(l));
        for (; a !== null;) ((R = a), Mf(a), (a = a.sibling));
        ((R = l), (Ll = s), (ve = c));
      }
      ic(e);
    } else l.subtreeFlags & 8772 && a !== null ? ((a.return = l), (R = a)) : ic(e);
  }
}
function ic(e) {
  for (; R !== null;) {
    var t = R;
    if (t.flags & 8772) {
      var n = t.alternate;
      try {
        if (t.flags & 8772)
          switch (t.tag) {
            case 0:
            case 11:
            case 15:
              ve || Ma(5, t);
              break;
            case 1:
              var r = t.stateNode;
              if (t.flags & 4 && !ve)
                if (n === null) r.componentDidMount();
                else {
                  var l = t.elementType === t.type ? n.memoizedProps : qe(t.type, n.memoizedProps);
                  r.componentDidUpdate(l, n.memoizedState, r.__reactInternalSnapshotBeforeUpdate);
                }
              var a = t.updateQueue;
              a !== null && Wu(t, a, r);
              break;
            case 3:
              var o = t.updateQueue;
              if (o !== null) {
                if (((n = null), t.child !== null))
                  switch (t.child.tag) {
                    case 5:
                      n = t.child.stateNode;
                      break;
                    case 1:
                      n = t.child.stateNode;
                  }
                Wu(t, o, n);
              }
              break;
            case 5:
              var s = t.stateNode;
              if (n === null && t.flags & 4) {
                n = s;
                var u = t.memoizedProps;
                switch (t.type) {
                  case 'button':
                  case 'input':
                  case 'select':
                  case 'textarea':
                    u.autoFocus && n.focus();
                    break;
                  case 'img':
                    u.src && (n.src = u.src);
                }
              }
              break;
            case 6:
              break;
            case 4:
              break;
            case 12:
              break;
            case 13:
              if (t.memoizedState === null) {
                var c = t.alternate;
                if (c !== null) {
                  var m = c.memoizedState;
                  if (m !== null) {
                    var d = m.dehydrated;
                    d !== null && Br(d);
                  }
                }
              }
              break;
            case 19:
            case 17:
            case 21:
            case 22:
            case 23:
            case 25:
              break;
            default:
              throw Error(C(163));
          }
        ve || (t.flags & 512 && wi(t));
      } catch (f) {
        Y(t, t.return, f);
      }
    }
    if (t === e) {
      R = null;
      break;
    }
    if (((n = t.sibling), n !== null)) {
      ((n.return = t.return), (R = n));
      break;
    }
    R = t.return;
  }
}
function sc(e) {
  for (; R !== null;) {
    var t = R;
    if (t === e) {
      R = null;
      break;
    }
    var n = t.sibling;
    if (n !== null) {
      ((n.return = t.return), (R = n));
      break;
    }
    R = t.return;
  }
}
function uc(e) {
  for (; R !== null;) {
    var t = R;
    try {
      switch (t.tag) {
        case 0:
        case 11:
        case 15:
          var n = t.return;
          try {
            Ma(4, t);
          } catch (u) {
            Y(t, n, u);
          }
          break;
        case 1:
          var r = t.stateNode;
          if (typeof r.componentDidMount == 'function') {
            var l = t.return;
            try {
              r.componentDidMount();
            } catch (u) {
              Y(t, l, u);
            }
          }
          var a = t.return;
          try {
            wi(t);
          } catch (u) {
            Y(t, a, u);
          }
          break;
        case 5:
          var o = t.return;
          try {
            wi(t);
          } catch (u) {
            Y(t, o, u);
          }
      }
    } catch (u) {
      Y(t, t.return, u);
    }
    if (t === e) {
      R = null;
      break;
    }
    var s = t.sibling;
    if (s !== null) {
      ((s.return = t.return), (R = s));
      break;
    }
    R = t.return;
  }
}
var pg = Math.ceil,
  ma = Et.ReactCurrentDispatcher,
  Es = Et.ReactCurrentOwner,
  Ve = Et.ReactCurrentBatchConfig,
  D = 0,
  ue = null,
  te = null,
  de = 0,
  Te = 0,
  In = Jt(0),
  oe = 0,
  Jr = null,
  pn = 0,
  Oa = 0,
  _s = 0,
  Rr = null,
  Se = null,
  Ps = 0,
  Yn = 1 / 0,
  vt = null,
  ga = !1,
  Si = null,
  Vt = null,
  Rl = !1,
  It = null,
  va = 0,
  br = 0,
  Ni = null,
  Ql = -1,
  Kl = 0;
function we() {
  return D & 6 ? G() : Ql !== -1 ? Ql : (Ql = G());
}
function Ht(e) {
  return e.mode & 1
    ? D & 2 && de !== 0
      ? de & -de
      : Jm.transition !== null
        ? (Kl === 0 && (Kl = gd()), Kl)
        : ((e = z), e !== 0 || ((e = window.event), (e = e === void 0 ? 16 : Sd(e.type))), e)
    : 1;
}
function Xe(e, t, n, r) {
  if (50 < br) throw ((br = 0), (Ni = null), Error(C(185)));
  (ll(e, n, r),
    (!(D & 2) || e !== ue) &&
      (e === ue && (!(D & 2) && (Oa |= n), oe === 4 && Mt(e, de)),
      _e(e, r),
      n === 1 && D === 0 && !(t.mode & 1) && ((Yn = G() + 500), La && Gt())));
}
function _e(e, t) {
  var n = e.callbackNode;
  Jh(e, t);
  var r = ea(e, e === ue ? de : 0);
  if (r === 0) (n !== null && yu(n), (e.callbackNode = null), (e.callbackPriority = 0));
  else if (((t = r & -r), e.callbackPriority !== t)) {
    if ((n != null && yu(n), t === 1))
      (e.tag === 0 ? Ym(cc.bind(null, e)) : Ud(cc.bind(null, e)),
        Wm(function () {
          !(D & 6) && Gt();
        }),
        (n = null));
    else {
      switch (vd(r)) {
        case 1:
          n = es;
          break;
        case 4:
          n = hd;
          break;
        case 16:
          n = Zl;
          break;
        case 536870912:
          n = md;
          break;
        default:
          n = Zl;
      }
      n = $f(n, Of.bind(null, e));
    }
    ((e.callbackPriority = t), (e.callbackNode = n));
  }
}
function Of(e, t) {
  if (((Ql = -1), (Kl = 0), D & 6)) throw Error(C(327));
  var n = e.callbackNode;
  if ($n() && e.callbackNode !== n) return null;
  var r = ea(e, e === ue ? de : 0);
  if (r === 0) return null;
  if (r & 30 || r & e.expiredLanes || t) t = ya(e, r);
  else {
    t = r;
    var l = D;
    D |= 2;
    var a = Af();
    (ue !== e || de !== t) && ((vt = null), (Yn = G() + 500), on(e, t));
    do
      try {
        gg();
        break;
      } catch (s) {
        If(e, s);
      }
    while (!0);
    (ps(), (ma.current = a), (D = l), te !== null ? (t = 0) : ((ue = null), (de = 0), (t = oe)));
  }
  if (t !== 0) {
    if ((t === 2 && ((l = Go(e)), l !== 0 && ((r = l), (t = Ci(e, l)))), t === 1))
      throw ((n = Jr), on(e, 0), Mt(e, r), _e(e, G()), n);
    if (t === 6) Mt(e, r);
    else {
      if (
        ((l = e.current.alternate),
        !(r & 30) &&
          !hg(l) &&
          ((t = ya(e, r)), t === 2 && ((a = Go(e)), a !== 0 && ((r = a), (t = Ci(e, a)))), t === 1))
      )
        throw ((n = Jr), on(e, 0), Mt(e, r), _e(e, G()), n);
      switch (((e.finishedWork = l), (e.finishedLanes = r), t)) {
        case 0:
        case 1:
          throw Error(C(345));
        case 2:
          tn(e, Se, vt);
          break;
        case 3:
          if ((Mt(e, r), (r & 130023424) === r && ((t = Ps + 500 - G()), 10 < t))) {
            if (ea(e, 0) !== 0) break;
            if (((l = e.suspendedLanes), (l & r) !== r)) {
              (we(), (e.pingedLanes |= e.suspendedLanes & l));
              break;
            }
            e.timeoutHandle = ai(tn.bind(null, e, Se, vt), t);
            break;
          }
          tn(e, Se, vt);
          break;
        case 4:
          if ((Mt(e, r), (r & 4194240) === r)) break;
          for (t = e.eventTimes, l = -1; 0 < r;) {
            var o = 31 - Ge(r);
            ((a = 1 << o), (o = t[o]), o > l && (l = o), (r &= ~a));
          }
          if (
            ((r = l),
            (r = G() - r),
            (r =
              (120 > r
                ? 120
                : 480 > r
                  ? 480
                  : 1080 > r
                    ? 1080
                    : 1920 > r
                      ? 1920
                      : 3e3 > r
                        ? 3e3
                        : 4320 > r
                          ? 4320
                          : 1960 * pg(r / 1960)) - r),
            10 < r)
          ) {
            e.timeoutHandle = ai(tn.bind(null, e, Se, vt), r);
            break;
          }
          tn(e, Se, vt);
          break;
        case 5:
          tn(e, Se, vt);
          break;
        default:
          throw Error(C(329));
      }
    }
  }
  return (_e(e, G()), e.callbackNode === n ? Of.bind(null, e) : null);
}
function Ci(e, t) {
  var n = Rr;
  return (
    e.current.memoizedState.isDehydrated && (on(e, t).flags |= 256),
    (e = ya(e, t)),
    e !== 2 && ((t = Se), (Se = n), t !== null && Ei(t)),
    e
  );
}
function Ei(e) {
  Se === null ? (Se = e) : Se.push.apply(Se, e);
}
function hg(e) {
  for (var t = e; ;) {
    if (t.flags & 16384) {
      var n = t.updateQueue;
      if (n !== null && ((n = n.stores), n !== null))
        for (var r = 0; r < n.length; r++) {
          var l = n[r],
            a = l.getSnapshot;
          l = l.value;
          try {
            if (!Ze(a(), l)) return !1;
          } catch {
            return !1;
          }
        }
    }
    if (((n = t.child), t.subtreeFlags & 16384 && n !== null)) ((n.return = t), (t = n));
    else {
      if (t === e) break;
      for (; t.sibling === null;) {
        if (t.return === null || t.return === e) return !0;
        t = t.return;
      }
      ((t.sibling.return = t.return), (t = t.sibling));
    }
  }
  return !0;
}
function Mt(e, t) {
  for (
    t &= ~_s, t &= ~Oa, e.suspendedLanes |= t, e.pingedLanes &= ~t, e = e.expirationTimes;
    0 < t;
  ) {
    var n = 31 - Ge(t),
      r = 1 << n;
    ((e[n] = -1), (t &= ~r));
  }
}
function cc(e) {
  if (D & 6) throw Error(C(327));
  $n();
  var t = ea(e, 0);
  if (!(t & 1)) return (_e(e, G()), null);
  var n = ya(e, t);
  if (e.tag !== 0 && n === 2) {
    var r = Go(e);
    r !== 0 && ((t = r), (n = Ci(e, r)));
  }
  if (n === 1) throw ((n = Jr), on(e, 0), Mt(e, t), _e(e, G()), n);
  if (n === 6) throw Error(C(345));
  return (
    (e.finishedWork = e.current.alternate),
    (e.finishedLanes = t),
    tn(e, Se, vt),
    _e(e, G()),
    null
  );
}
function Ts(e, t) {
  var n = D;
  D |= 1;
  try {
    return e(t);
  } finally {
    ((D = n), D === 0 && ((Yn = G() + 500), La && Gt()));
  }
}
function hn(e) {
  It !== null && It.tag === 0 && !(D & 6) && $n();
  var t = D;
  D |= 1;
  var n = Ve.transition,
    r = z;
  try {
    if (((Ve.transition = null), (z = 1), e)) return e();
  } finally {
    ((z = r), (Ve.transition = n), (D = t), !(D & 6) && Gt());
  }
}
function Ls() {
  ((Te = In.current), V(In));
}
function on(e, t) {
  ((e.finishedWork = null), (e.finishedLanes = 0));
  var n = e.timeoutHandle;
  if ((n !== -1 && ((e.timeoutHandle = -1), Hm(n)), te !== null))
    for (n = te.return; n !== null;) {
      var r = n;
      switch ((cs(r), r.tag)) {
        case 1:
          ((r = r.type.childContextTypes), r != null && aa());
          break;
        case 3:
          (Kn(), V(Ce), V(ye), xs());
          break;
        case 5:
          ys(r);
          break;
        case 4:
          Kn();
          break;
        case 13:
          V(W);
          break;
        case 19:
          V(W);
          break;
        case 10:
          hs(r.type._context);
          break;
        case 22:
        case 23:
          Ls();
      }
      n = n.return;
    }
  if (
    ((ue = e),
    (te = e = Wt(e.current, null)),
    (de = Te = t),
    (oe = 0),
    (Jr = null),
    (_s = Oa = pn = 0),
    (Se = Rr = null),
    ln !== null)
  ) {
    for (t = 0; t < ln.length; t++)
      if (((n = ln[t]), (r = n.interleaved), r !== null)) {
        n.interleaved = null;
        var l = r.next,
          a = n.pending;
        if (a !== null) {
          var o = a.next;
          ((a.next = l), (r.next = o));
        }
        n.pending = r;
      }
    ln = null;
  }
  return e;
}
function If(e, t) {
  do {
    var n = te;
    try {
      if ((ps(), (Vl.current = ha), pa)) {
        for (var r = Q.memoizedState; r !== null;) {
          var l = r.queue;
          (l !== null && (l.pending = null), (r = r.next));
        }
        pa = !1;
      }
      if (
        ((fn = 0),
        (ie = ae = Q = null),
        (Tr = !1),
        (Kr = 0),
        (Es.current = null),
        n === null || n.return === null)
      ) {
        ((oe = 1), (Jr = t), (te = null));
        break;
      }
      e: {
        var a = e,
          o = n.return,
          s = n,
          u = t;
        if (
          ((t = de),
          (s.flags |= 32768),
          u !== null && typeof u == 'object' && typeof u.then == 'function')
        ) {
          var c = u,
            m = s,
            d = m.tag;
          if (!(m.mode & 1) && (d === 0 || d === 11 || d === 15)) {
            var f = m.alternate;
            f
              ? ((m.updateQueue = f.updateQueue),
                (m.memoizedState = f.memoizedState),
                (m.lanes = f.lanes))
              : ((m.updateQueue = null), (m.memoizedState = null));
          }
          var v = Gu(o);
          if (v !== null) {
            ((v.flags &= -257), Xu(v, o, s, a, t), v.mode & 1 && Ju(a, c, t), (t = v), (u = c));
            var k = t.updateQueue;
            if (k === null) {
              var w = new Set();
              (w.add(u), (t.updateQueue = w));
            } else k.add(u);
            break e;
          } else {
            if (!(t & 1)) {
              (Ju(a, c, t), Rs());
              break e;
            }
            u = Error(C(426));
          }
        } else if (H && s.mode & 1) {
          var j = Gu(o);
          if (j !== null) {
            (!(j.flags & 65536) && (j.flags |= 256), Xu(j, o, s, a, t), ds(qn(u, s)));
            break e;
          }
        }
        ((a = u = qn(u, s)), oe !== 4 && (oe = 2), Rr === null ? (Rr = [a]) : Rr.push(a), (a = o));
        do {
          switch (a.tag) {
            case 3:
              ((a.flags |= 65536), (t &= -t), (a.lanes |= t));
              var h = yf(a, u, t);
              Hu(a, h);
              break e;
            case 1:
              s = u;
              var p = a.type,
                g = a.stateNode;
              if (
                !(a.flags & 128) &&
                (typeof p.getDerivedStateFromError == 'function' ||
                  (g !== null &&
                    typeof g.componentDidCatch == 'function' &&
                    (Vt === null || !Vt.has(g))))
              ) {
                ((a.flags |= 65536), (t &= -t), (a.lanes |= t));
                var y = xf(a, s, t);
                Hu(a, y);
                break e;
              }
          }
          a = a.return;
        } while (a !== null);
      }
      zf(n);
    } catch (S) {
      ((t = S), te === n && n !== null && (te = n = n.return));
      continue;
    }
    break;
  } while (!0);
}
function Af() {
  var e = ma.current;
  return ((ma.current = ha), e === null ? ha : e);
}
function Rs() {
  ((oe === 0 || oe === 3 || oe === 2) && (oe = 4),
    ue === null || (!(pn & 268435455) && !(Oa & 268435455)) || Mt(ue, de));
}
function ya(e, t) {
  var n = D;
  D |= 2;
  var r = Af();
  (ue !== e || de !== t) && ((vt = null), on(e, t));
  do
    try {
      mg();
      break;
    } catch (l) {
      If(e, l);
    }
  while (!0);
  if ((ps(), (D = n), (ma.current = r), te !== null)) throw Error(C(261));
  return ((ue = null), (de = 0), oe);
}
function mg() {
  for (; te !== null;) Df(te);
}
function gg() {
  for (; te !== null && !$h();) Df(te);
}
function Df(e) {
  var t = Ff(e.alternate, e, Te);
  ((e.memoizedProps = e.pendingProps), t === null ? zf(e) : (te = t), (Es.current = null));
}
function zf(e) {
  var t = e;
  do {
    var n = t.alternate;
    if (((e = t.return), t.flags & 32768)) {
      if (((n = ug(n, t)), n !== null)) {
        ((n.flags &= 32767), (te = n));
        return;
      }
      if (e !== null) ((e.flags |= 32768), (e.subtreeFlags = 0), (e.deletions = null));
      else {
        ((oe = 6), (te = null));
        return;
      }
    } else if (((n = sg(n, t, Te)), n !== null)) {
      te = n;
      return;
    }
    if (((t = t.sibling), t !== null)) {
      te = t;
      return;
    }
    te = t = e;
  } while (t !== null);
  oe === 0 && (oe = 5);
}
function tn(e, t, n) {
  var r = z,
    l = Ve.transition;
  try {
    ((Ve.transition = null), (z = 1), vg(e, t, n, r));
  } finally {
    ((Ve.transition = l), (z = r));
  }
  return null;
}
function vg(e, t, n, r) {
  do $n();
  while (It !== null);
  if (D & 6) throw Error(C(327));
  n = e.finishedWork;
  var l = e.finishedLanes;
  if (n === null) return null;
  if (((e.finishedWork = null), (e.finishedLanes = 0), n === e.current)) throw Error(C(177));
  ((e.callbackNode = null), (e.callbackPriority = 0));
  var a = n.lanes | n.childLanes;
  if (
    (Gh(e, a),
    e === ue && ((te = ue = null), (de = 0)),
    (!(n.subtreeFlags & 2064) && !(n.flags & 2064)) ||
      Rl ||
      ((Rl = !0),
      $f(Zl, function () {
        return ($n(), null);
      })),
    (a = (n.flags & 15990) !== 0),
    n.subtreeFlags & 15990 || a)
  ) {
    ((a = Ve.transition), (Ve.transition = null));
    var o = z;
    z = 1;
    var s = D;
    ((D |= 4),
      (Es.current = null),
      dg(e, n),
      bf(n, e),
      Dm(ri),
      (ta = !!ni),
      (ri = ni = null),
      (e.current = n),
      fg(n),
      Uh(),
      (D = s),
      (z = o),
      (Ve.transition = a));
  } else e.current = n;
  if (
    (Rl && ((Rl = !1), (It = e), (va = l)),
    (a = e.pendingLanes),
    a === 0 && (Vt = null),
    Wh(n.stateNode),
    _e(e, G()),
    t !== null)
  )
    for (r = e.onRecoverableError, n = 0; n < t.length; n++)
      ((l = t[n]), r(l.value, { componentStack: l.stack, digest: l.digest }));
  if (ga) throw ((ga = !1), (e = Si), (Si = null), e);
  return (
    va & 1 && e.tag !== 0 && $n(),
    (a = e.pendingLanes),
    a & 1 ? (e === Ni ? br++ : ((br = 0), (Ni = e))) : (br = 0),
    Gt(),
    null
  );
}
function $n() {
  if (It !== null) {
    var e = vd(va),
      t = Ve.transition,
      n = z;
    try {
      if (((Ve.transition = null), (z = 16 > e ? 16 : e), It === null)) var r = !1;
      else {
        if (((e = It), (It = null), (va = 0), D & 6)) throw Error(C(331));
        var l = D;
        for (D |= 4, R = e.current; R !== null;) {
          var a = R,
            o = a.child;
          if (R.flags & 16) {
            var s = a.deletions;
            if (s !== null) {
              for (var u = 0; u < s.length; u++) {
                var c = s[u];
                for (R = c; R !== null;) {
                  var m = R;
                  switch (m.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Lr(8, m, a);
                  }
                  var d = m.child;
                  if (d !== null) ((d.return = m), (R = d));
                  else
                    for (; R !== null;) {
                      m = R;
                      var f = m.sibling,
                        v = m.return;
                      if ((Tf(m), m === c)) {
                        R = null;
                        break;
                      }
                      if (f !== null) {
                        ((f.return = v), (R = f));
                        break;
                      }
                      R = v;
                    }
                }
              }
              var k = a.alternate;
              if (k !== null) {
                var w = k.child;
                if (w !== null) {
                  k.child = null;
                  do {
                    var j = w.sibling;
                    ((w.sibling = null), (w = j));
                  } while (w !== null);
                }
              }
              R = a;
            }
          }
          if (a.subtreeFlags & 2064 && o !== null) ((o.return = a), (R = o));
          else
            e: for (; R !== null;) {
              if (((a = R), a.flags & 2048))
                switch (a.tag) {
                  case 0:
                  case 11:
                  case 15:
                    Lr(9, a, a.return);
                }
              var h = a.sibling;
              if (h !== null) {
                ((h.return = a.return), (R = h));
                break e;
              }
              R = a.return;
            }
        }
        var p = e.current;
        for (R = p; R !== null;) {
          o = R;
          var g = o.child;
          if (o.subtreeFlags & 2064 && g !== null) ((g.return = o), (R = g));
          else
            e: for (o = p; R !== null;) {
              if (((s = R), s.flags & 2048))
                try {
                  switch (s.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Ma(9, s);
                  }
                } catch (S) {
                  Y(s, s.return, S);
                }
              if (s === o) {
                R = null;
                break e;
              }
              var y = s.sibling;
              if (y !== null) {
                ((y.return = s.return), (R = y));
                break e;
              }
              R = s.return;
            }
        }
        if (((D = l), Gt(), it && typeof it.onPostCommitFiberRoot == 'function'))
          try {
            it.onPostCommitFiberRoot(Ca, e);
          } catch {}
        r = !0;
      }
      return r;
    } finally {
      ((z = n), (Ve.transition = t));
    }
  }
  return !1;
}
function dc(e, t, n) {
  ((t = qn(n, t)),
    (t = yf(e, t, 1)),
    (e = Ut(e, t, 1)),
    (t = we()),
    e !== null && (ll(e, 1, t), _e(e, t)));
}
function Y(e, t, n) {
  if (e.tag === 3) dc(e, e, n);
  else
    for (; t !== null;) {
      if (t.tag === 3) {
        dc(t, e, n);
        break;
      } else if (t.tag === 1) {
        var r = t.stateNode;
        if (
          typeof t.type.getDerivedStateFromError == 'function' ||
          (typeof r.componentDidCatch == 'function' && (Vt === null || !Vt.has(r)))
        ) {
          ((e = qn(n, e)),
            (e = xf(t, e, 1)),
            (t = Ut(t, e, 1)),
            (e = we()),
            t !== null && (ll(t, 1, e), _e(t, e)));
          break;
        }
      }
      t = t.return;
    }
}
function yg(e, t, n) {
  var r = e.pingCache;
  (r !== null && r.delete(t),
    (t = we()),
    (e.pingedLanes |= e.suspendedLanes & n),
    ue === e &&
      (de & n) === n &&
      (oe === 4 || (oe === 3 && (de & 130023424) === de && 500 > G() - Ps) ? on(e, 0) : (_s |= n)),
    _e(e, t));
}
function Bf(e, t) {
  t === 0 && (e.mode & 1 ? ((t = kl), (kl <<= 1), !(kl & 130023424) && (kl = 4194304)) : (t = 1));
  var n = we();
  ((e = Nt(e, t)), e !== null && (ll(e, t, n), _e(e, n)));
}
function xg(e) {
  var t = e.memoizedState,
    n = 0;
  (t !== null && (n = t.retryLane), Bf(e, n));
}
function wg(e, t) {
  var n = 0;
  switch (e.tag) {
    case 13:
      var r = e.stateNode,
        l = e.memoizedState;
      l !== null && (n = l.retryLane);
      break;
    case 19:
      r = e.stateNode;
      break;
    default:
      throw Error(C(314));
  }
  (r !== null && r.delete(t), Bf(e, n));
}
var Ff;
Ff = function (e, t, n) {
  if (e !== null)
    if (e.memoizedProps !== t.pendingProps || Ce.current) Ne = !0;
    else {
      if (!(e.lanes & n) && !(t.flags & 128)) return ((Ne = !1), ig(e, t, n));
      Ne = !!(e.flags & 131072);
    }
  else ((Ne = !1), H && t.flags & 1048576 && Vd(t, sa, t.index));
  switch (((t.lanes = 0), t.tag)) {
    case 2:
      var r = t.type;
      (Wl(e, t), (e = t.pendingProps));
      var l = Hn(t, ye.current);
      (Fn(t, n), (l = ks(null, t, r, e, l, n)));
      var a = js();
      return (
        (t.flags |= 1),
        typeof l == 'object' && l !== null && typeof l.render == 'function' && l.$$typeof === void 0
          ? ((t.tag = 1),
            (t.memoizedState = null),
            (t.updateQueue = null),
            Ee(r) ? ((a = !0), oa(t)) : (a = !1),
            (t.memoizedState = l.state !== null && l.state !== void 0 ? l.state : null),
            gs(t),
            (l.updater = ba),
            (t.stateNode = l),
            (l._reactInternals = t),
            fi(t, r, e, n),
            (t = mi(null, t, r, !0, a, n)))
          : ((t.tag = 0), H && a && us(t), xe(null, t, l, n), (t = t.child)),
        t
      );
    case 16:
      r = t.elementType;
      e: {
        switch (
          (Wl(e, t),
          (e = t.pendingProps),
          (l = r._init),
          (r = l(r._payload)),
          (t.type = r),
          (l = t.tag = jg(r)),
          (e = qe(r, e)),
          l)
        ) {
          case 0:
            t = hi(null, t, r, e, n);
            break e;
          case 1:
            t = tc(null, t, r, e, n);
            break e;
          case 11:
            t = Zu(null, t, r, e, n);
            break e;
          case 14:
            t = ec(null, t, r, qe(r.type, e), n);
            break e;
        }
        throw Error(C(306, r, ''));
      }
      return t;
    case 0:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : qe(r, l)),
        hi(e, t, r, l, n)
      );
    case 1:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : qe(r, l)),
        tc(e, t, r, l, n)
      );
    case 3:
      e: {
        if ((Sf(t), e === null)) throw Error(C(387));
        ((r = t.pendingProps), (a = t.memoizedState), (l = a.element), Yd(e, t), da(t, r, null, n));
        var o = t.memoizedState;
        if (((r = o.element), a.isDehydrated))
          if (
            ((a = {
              element: r,
              isDehydrated: !1,
              cache: o.cache,
              pendingSuspenseBoundaries: o.pendingSuspenseBoundaries,
              transitions: o.transitions,
            }),
            (t.updateQueue.baseState = a),
            (t.memoizedState = a),
            t.flags & 256)
          ) {
            ((l = qn(Error(C(423)), t)), (t = nc(e, t, r, n, l)));
            break e;
          } else if (r !== l) {
            ((l = qn(Error(C(424)), t)), (t = nc(e, t, r, n, l)));
            break e;
          } else
            for (
              Le = $t(t.stateNode.containerInfo.firstChild),
                Re = t,
                H = !0,
                Je = null,
                n = Kd(t, null, r, n),
                t.child = n;
              n;
            )
              ((n.flags = (n.flags & -3) | 4096), (n = n.sibling));
        else {
          if ((Wn(), r === l)) {
            t = Ct(e, t, n);
            break e;
          }
          xe(e, t, r, n);
        }
        t = t.child;
      }
      return t;
    case 5:
      return (
        Jd(t),
        e === null && ui(t),
        (r = t.type),
        (l = t.pendingProps),
        (a = e !== null ? e.memoizedProps : null),
        (o = l.children),
        li(r, l) ? (o = null) : a !== null && li(r, a) && (t.flags |= 32),
        jf(e, t),
        xe(e, t, o, n),
        t.child
      );
    case 6:
      return (e === null && ui(t), null);
    case 13:
      return Nf(e, t, n);
    case 4:
      return (
        vs(t, t.stateNode.containerInfo),
        (r = t.pendingProps),
        e === null ? (t.child = Qn(t, null, r, n)) : xe(e, t, r, n),
        t.child
      );
    case 11:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : qe(r, l)),
        Zu(e, t, r, l, n)
      );
    case 7:
      return (xe(e, t, t.pendingProps, n), t.child);
    case 8:
      return (xe(e, t, t.pendingProps.children, n), t.child);
    case 12:
      return (xe(e, t, t.pendingProps.children, n), t.child);
    case 10:
      e: {
        if (
          ((r = t.type._context),
          (l = t.pendingProps),
          (a = t.memoizedProps),
          (o = l.value),
          F(ua, r._currentValue),
          (r._currentValue = o),
          a !== null)
        )
          if (Ze(a.value, o)) {
            if (a.children === l.children && !Ce.current) {
              t = Ct(e, t, n);
              break e;
            }
          } else
            for (a = t.child, a !== null && (a.return = t); a !== null;) {
              var s = a.dependencies;
              if (s !== null) {
                o = a.child;
                for (var u = s.firstContext; u !== null;) {
                  if (u.context === r) {
                    if (a.tag === 1) {
                      ((u = kt(-1, n & -n)), (u.tag = 2));
                      var c = a.updateQueue;
                      if (c !== null) {
                        c = c.shared;
                        var m = c.pending;
                        (m === null ? (u.next = u) : ((u.next = m.next), (m.next = u)),
                          (c.pending = u));
                      }
                    }
                    ((a.lanes |= n),
                      (u = a.alternate),
                      u !== null && (u.lanes |= n),
                      ci(a.return, n, t),
                      (s.lanes |= n));
                    break;
                  }
                  u = u.next;
                }
              } else if (a.tag === 10) o = a.type === t.type ? null : a.child;
              else if (a.tag === 18) {
                if (((o = a.return), o === null)) throw Error(C(341));
                ((o.lanes |= n),
                  (s = o.alternate),
                  s !== null && (s.lanes |= n),
                  ci(o, n, t),
                  (o = a.sibling));
              } else o = a.child;
              if (o !== null) o.return = a;
              else
                for (o = a; o !== null;) {
                  if (o === t) {
                    o = null;
                    break;
                  }
                  if (((a = o.sibling), a !== null)) {
                    ((a.return = o.return), (o = a));
                    break;
                  }
                  o = o.return;
                }
              a = o;
            }
        (xe(e, t, l.children, n), (t = t.child));
      }
      return t;
    case 9:
      return (
        (l = t.type),
        (r = t.pendingProps.children),
        Fn(t, n),
        (l = He(l)),
        (r = r(l)),
        (t.flags |= 1),
        xe(e, t, r, n),
        t.child
      );
    case 14:
      return ((r = t.type), (l = qe(r, t.pendingProps)), (l = qe(r.type, l)), ec(e, t, r, l, n));
    case 15:
      return wf(e, t, t.type, t.pendingProps, n);
    case 17:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : qe(r, l)),
        Wl(e, t),
        (t.tag = 1),
        Ee(r) ? ((e = !0), oa(t)) : (e = !1),
        Fn(t, n),
        vf(t, r, l),
        fi(t, r, l, n),
        mi(null, t, r, !0, e, n)
      );
    case 19:
      return Cf(e, t, n);
    case 22:
      return kf(e, t, n);
  }
  throw Error(C(156, t.tag));
};
function $f(e, t) {
  return pd(e, t);
}
function kg(e, t, n, r) {
  ((this.tag = e),
    (this.key = n),
    (this.sibling =
      this.child =
      this.return =
      this.stateNode =
      this.type =
      this.elementType =
        null),
    (this.index = 0),
    (this.ref = null),
    (this.pendingProps = t),
    (this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null),
    (this.mode = r),
    (this.subtreeFlags = this.flags = 0),
    (this.deletions = null),
    (this.childLanes = this.lanes = 0),
    (this.alternate = null));
}
function $e(e, t, n, r) {
  return new kg(e, t, n, r);
}
function bs(e) {
  return ((e = e.prototype), !(!e || !e.isReactComponent));
}
function jg(e) {
  if (typeof e == 'function') return bs(e) ? 1 : 0;
  if (e != null) {
    if (((e = e.$$typeof), e === Gi)) return 11;
    if (e === Xi) return 14;
  }
  return 2;
}
function Wt(e, t) {
  var n = e.alternate;
  return (
    n === null
      ? ((n = $e(e.tag, t, e.key, e.mode)),
        (n.elementType = e.elementType),
        (n.type = e.type),
        (n.stateNode = e.stateNode),
        (n.alternate = e),
        (e.alternate = n))
      : ((n.pendingProps = t),
        (n.type = e.type),
        (n.flags = 0),
        (n.subtreeFlags = 0),
        (n.deletions = null)),
    (n.flags = e.flags & 14680064),
    (n.childLanes = e.childLanes),
    (n.lanes = e.lanes),
    (n.child = e.child),
    (n.memoizedProps = e.memoizedProps),
    (n.memoizedState = e.memoizedState),
    (n.updateQueue = e.updateQueue),
    (t = e.dependencies),
    (n.dependencies = t === null ? null : { lanes: t.lanes, firstContext: t.firstContext }),
    (n.sibling = e.sibling),
    (n.index = e.index),
    (n.ref = e.ref),
    n
  );
}
function ql(e, t, n, r, l, a) {
  var o = 2;
  if (((r = e), typeof e == 'function')) bs(e) && (o = 1);
  else if (typeof e == 'string') o = 5;
  else
    e: switch (e) {
      case Cn:
        return sn(n.children, l, a, t);
      case Ji:
        ((o = 8), (l |= 8));
        break;
      case Ao:
        return ((e = $e(12, n, t, l | 2)), (e.elementType = Ao), (e.lanes = a), e);
      case Do:
        return ((e = $e(13, n, t, l)), (e.elementType = Do), (e.lanes = a), e);
      case zo:
        return ((e = $e(19, n, t, l)), (e.elementType = zo), (e.lanes = a), e);
      case Jc:
        return Ia(n, l, a, t);
      default:
        if (typeof e == 'object' && e !== null)
          switch (e.$$typeof) {
            case qc:
              o = 10;
              break e;
            case Yc:
              o = 9;
              break e;
            case Gi:
              o = 11;
              break e;
            case Xi:
              o = 14;
              break e;
            case Lt:
              ((o = 16), (r = null));
              break e;
          }
        throw Error(C(130, e == null ? e : typeof e, ''));
    }
  return ((t = $e(o, n, t, l)), (t.elementType = e), (t.type = r), (t.lanes = a), t);
}
function sn(e, t, n, r) {
  return ((e = $e(7, e, r, t)), (e.lanes = n), e);
}
function Ia(e, t, n, r) {
  return (
    (e = $e(22, e, r, t)),
    (e.elementType = Jc),
    (e.lanes = n),
    (e.stateNode = { isHidden: !1 }),
    e
  );
}
function Co(e, t, n) {
  return ((e = $e(6, e, null, t)), (e.lanes = n), e);
}
function Eo(e, t, n) {
  return (
    (t = $e(4, e.children !== null ? e.children : [], e.key, t)),
    (t.lanes = n),
    (t.stateNode = {
      containerInfo: e.containerInfo,
      pendingChildren: null,
      implementation: e.implementation,
    }),
    t
  );
}
function Sg(e, t, n, r, l) {
  ((this.tag = t),
    (this.containerInfo = e),
    (this.finishedWork = this.pingCache = this.current = this.pendingChildren = null),
    (this.timeoutHandle = -1),
    (this.callbackNode = this.pendingContext = this.context = null),
    (this.callbackPriority = 0),
    (this.eventTimes = ao(0)),
    (this.expirationTimes = ao(-1)),
    (this.entangledLanes =
      this.finishedLanes =
      this.mutableReadLanes =
      this.expiredLanes =
      this.pingedLanes =
      this.suspendedLanes =
      this.pendingLanes =
        0),
    (this.entanglements = ao(0)),
    (this.identifierPrefix = r),
    (this.onRecoverableError = l),
    (this.mutableSourceEagerHydrationData = null));
}
function Ms(e, t, n, r, l, a, o, s, u) {
  return (
    (e = new Sg(e, t, n, s, u)),
    t === 1 ? ((t = 1), a === !0 && (t |= 8)) : (t = 0),
    (a = $e(3, null, null, t)),
    (e.current = a),
    (a.stateNode = e),
    (a.memoizedState = {
      element: r,
      isDehydrated: n,
      cache: null,
      transitions: null,
      pendingSuspenseBoundaries: null,
    }),
    gs(a),
    e
  );
}
function Ng(e, t, n) {
  var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
  return {
    $$typeof: Nn,
    key: r == null ? null : '' + r,
    children: e,
    containerInfo: t,
    implementation: n,
  };
}
function Uf(e) {
  if (!e) return qt;
  e = e._reactInternals;
  e: {
    if (gn(e) !== e || e.tag !== 1) throw Error(C(170));
    var t = e;
    do {
      switch (t.tag) {
        case 3:
          t = t.stateNode.context;
          break e;
        case 1:
          if (Ee(t.type)) {
            t = t.stateNode.__reactInternalMemoizedMergedChildContext;
            break e;
          }
      }
      t = t.return;
    } while (t !== null);
    throw Error(C(171));
  }
  if (e.tag === 1) {
    var n = e.type;
    if (Ee(n)) return $d(e, n, t);
  }
  return t;
}
function Vf(e, t, n, r, l, a, o, s, u) {
  return (
    (e = Ms(n, r, !0, e, l, a, o, s, u)),
    (e.context = Uf(null)),
    (n = e.current),
    (r = we()),
    (l = Ht(n)),
    (a = kt(r, l)),
    (a.callback = t ?? null),
    Ut(n, a, l),
    (e.current.lanes = l),
    ll(e, l, r),
    _e(e, r),
    e
  );
}
function Aa(e, t, n, r) {
  var l = t.current,
    a = we(),
    o = Ht(l);
  return (
    (n = Uf(n)),
    t.context === null ? (t.context = n) : (t.pendingContext = n),
    (t = kt(a, o)),
    (t.payload = { element: e }),
    (r = r === void 0 ? null : r),
    r !== null && (t.callback = r),
    (e = Ut(l, t, o)),
    e !== null && (Xe(e, l, o, a), Ul(e, l, o)),
    o
  );
}
function xa(e) {
  if (((e = e.current), !e.child)) return null;
  switch (e.child.tag) {
    case 5:
      return e.child.stateNode;
    default:
      return e.child.stateNode;
  }
}
function fc(e, t) {
  if (((e = e.memoizedState), e !== null && e.dehydrated !== null)) {
    var n = e.retryLane;
    e.retryLane = n !== 0 && n < t ? n : t;
  }
}
function Os(e, t) {
  (fc(e, t), (e = e.alternate) && fc(e, t));
}
function Cg() {
  return null;
}
var Hf =
  typeof reportError == 'function'
    ? reportError
    : function (e) {
        console.error(e);
      };
function Is(e) {
  this._internalRoot = e;
}
Da.prototype.render = Is.prototype.render = function (e) {
  var t = this._internalRoot;
  if (t === null) throw Error(C(409));
  Aa(e, t, null, null);
};
Da.prototype.unmount = Is.prototype.unmount = function () {
  var e = this._internalRoot;
  if (e !== null) {
    this._internalRoot = null;
    var t = e.containerInfo;
    (hn(function () {
      Aa(null, e, null, null);
    }),
      (t[St] = null));
  }
};
function Da(e) {
  this._internalRoot = e;
}
Da.prototype.unstable_scheduleHydration = function (e) {
  if (e) {
    var t = wd();
    e = { blockedOn: null, target: e, priority: t };
    for (var n = 0; n < bt.length && t !== 0 && t < bt[n].priority; n++);
    (bt.splice(n, 0, e), n === 0 && jd(e));
  }
};
function As(e) {
  return !(!e || (e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11));
}
function za(e) {
  return !(
    !e ||
    (e.nodeType !== 1 &&
      e.nodeType !== 9 &&
      e.nodeType !== 11 &&
      (e.nodeType !== 8 || e.nodeValue !== ' react-mount-point-unstable '))
  );
}
function pc() {}
function Eg(e, t, n, r, l) {
  if (l) {
    if (typeof r == 'function') {
      var a = r;
      r = function () {
        var c = xa(o);
        a.call(c);
      };
    }
    var o = Vf(t, r, e, 0, null, !1, !1, '', pc);
    return (
      (e._reactRootContainer = o),
      (e[St] = o.current),
      Ur(e.nodeType === 8 ? e.parentNode : e),
      hn(),
      o
    );
  }
  for (; (l = e.lastChild);) e.removeChild(l);
  if (typeof r == 'function') {
    var s = r;
    r = function () {
      var c = xa(u);
      s.call(c);
    };
  }
  var u = Ms(e, 0, !1, null, null, !1, !1, '', pc);
  return (
    (e._reactRootContainer = u),
    (e[St] = u.current),
    Ur(e.nodeType === 8 ? e.parentNode : e),
    hn(function () {
      Aa(t, u, n, r);
    }),
    u
  );
}
function Ba(e, t, n, r, l) {
  var a = n._reactRootContainer;
  if (a) {
    var o = a;
    if (typeof l == 'function') {
      var s = l;
      l = function () {
        var u = xa(o);
        s.call(u);
      };
    }
    Aa(t, o, e, l);
  } else o = Eg(n, t, e, l, r);
  return xa(o);
}
yd = function (e) {
  switch (e.tag) {
    case 3:
      var t = e.stateNode;
      if (t.current.memoizedState.isDehydrated) {
        var n = jr(t.pendingLanes);
        n !== 0 && (ts(t, n | 1), _e(t, G()), !(D & 6) && ((Yn = G() + 500), Gt()));
      }
      break;
    case 13:
      (hn(function () {
        var r = Nt(e, 1);
        if (r !== null) {
          var l = we();
          Xe(r, e, 1, l);
        }
      }),
        Os(e, 1));
  }
};
ns = function (e) {
  if (e.tag === 13) {
    var t = Nt(e, 134217728);
    if (t !== null) {
      var n = we();
      Xe(t, e, 134217728, n);
    }
    Os(e, 134217728);
  }
};
xd = function (e) {
  if (e.tag === 13) {
    var t = Ht(e),
      n = Nt(e, t);
    if (n !== null) {
      var r = we();
      Xe(n, e, t, r);
    }
    Os(e, t);
  }
};
wd = function () {
  return z;
};
kd = function (e, t) {
  var n = z;
  try {
    return ((z = e), t());
  } finally {
    z = n;
  }
};
qo = function (e, t, n) {
  switch (t) {
    case 'input':
      if (($o(e, n), (t = n.name), n.type === 'radio' && t != null)) {
        for (n = e; n.parentNode;) n = n.parentNode;
        for (
          n = n.querySelectorAll('input[name=' + JSON.stringify('' + t) + '][type="radio"]'), t = 0;
          t < n.length;
          t++
        ) {
          var r = n[t];
          if (r !== e && r.form === e.form) {
            var l = Ta(r);
            if (!l) throw Error(C(90));
            (Xc(r), $o(r, l));
          }
        }
      }
      break;
    case 'textarea':
      ed(e, n);
      break;
    case 'select':
      ((t = n.value), t != null && An(e, !!n.multiple, t, !1));
  }
};
id = Ts;
sd = hn;
var _g = { usingClientEntryPoint: !1, Events: [ol, Tn, Ta, ad, od, Ts] },
  yr = {
    findFiberByHostInstance: rn,
    bundleType: 0,
    version: '18.3.1',
    rendererPackageName: 'react-dom',
  },
  Pg = {
    bundleType: yr.bundleType,
    version: yr.version,
    rendererPackageName: yr.rendererPackageName,
    rendererConfig: yr.rendererConfig,
    overrideHookState: null,
    overrideHookStateDeletePath: null,
    overrideHookStateRenamePath: null,
    overrideProps: null,
    overridePropsDeletePath: null,
    overridePropsRenamePath: null,
    setErrorHandler: null,
    setSuspenseHandler: null,
    scheduleUpdate: null,
    currentDispatcherRef: Et.ReactCurrentDispatcher,
    findHostInstanceByFiber: function (e) {
      return ((e = dd(e)), e === null ? null : e.stateNode);
    },
    findFiberByHostInstance: yr.findFiberByHostInstance || Cg,
    findHostInstancesForRefresh: null,
    scheduleRefresh: null,
    scheduleRoot: null,
    setRefreshHandler: null,
    getCurrentFiber: null,
    reconcilerVersion: '18.3.1-next-f1338f8080-20240426',
  };
if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < 'u') {
  var bl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!bl.isDisabled && bl.supportsFiber)
    try {
      ((Ca = bl.inject(Pg)), (it = bl));
    } catch {}
}
Oe.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = _g;
Oe.createPortal = function (e, t) {
  var n = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
  if (!As(t)) throw Error(C(200));
  return Ng(e, t, null, n);
};
Oe.createRoot = function (e, t) {
  if (!As(e)) throw Error(C(299));
  var n = !1,
    r = '',
    l = Hf;
  return (
    t != null &&
      (t.unstable_strictMode === !0 && (n = !0),
      t.identifierPrefix !== void 0 && (r = t.identifierPrefix),
      t.onRecoverableError !== void 0 && (l = t.onRecoverableError)),
    (t = Ms(e, 1, !1, null, null, n, !1, r, l)),
    (e[St] = t.current),
    Ur(e.nodeType === 8 ? e.parentNode : e),
    new Is(t)
  );
};
Oe.findDOMNode = function (e) {
  if (e == null) return null;
  if (e.nodeType === 1) return e;
  var t = e._reactInternals;
  if (t === void 0)
    throw typeof e.render == 'function'
      ? Error(C(188))
      : ((e = Object.keys(e).join(',')), Error(C(268, e)));
  return ((e = dd(t)), (e = e === null ? null : e.stateNode), e);
};
Oe.flushSync = function (e) {
  return hn(e);
};
Oe.hydrate = function (e, t, n) {
  if (!za(t)) throw Error(C(200));
  return Ba(null, e, t, !0, n);
};
Oe.hydrateRoot = function (e, t, n) {
  if (!As(e)) throw Error(C(405));
  var r = (n != null && n.hydratedSources) || null,
    l = !1,
    a = '',
    o = Hf;
  if (
    (n != null &&
      (n.unstable_strictMode === !0 && (l = !0),
      n.identifierPrefix !== void 0 && (a = n.identifierPrefix),
      n.onRecoverableError !== void 0 && (o = n.onRecoverableError)),
    (t = Vf(t, null, e, 1, n ?? null, l, !1, a, o)),
    (e[St] = t.current),
    Ur(e),
    r)
  )
    for (e = 0; e < r.length; e++)
      ((n = r[e]),
        (l = n._getVersion),
        (l = l(n._source)),
        t.mutableSourceEagerHydrationData == null
          ? (t.mutableSourceEagerHydrationData = [n, l])
          : t.mutableSourceEagerHydrationData.push(n, l));
  return new Da(t);
};
Oe.render = function (e, t, n) {
  if (!za(t)) throw Error(C(200));
  return Ba(null, e, t, !1, n);
};
Oe.unmountComponentAtNode = function (e) {
  if (!za(e)) throw Error(C(40));
  return e._reactRootContainer
    ? (hn(function () {
        Ba(null, null, e, !1, function () {
          ((e._reactRootContainer = null), (e[St] = null));
        });
      }),
      !0)
    : !1;
};
Oe.unstable_batchedUpdates = Ts;
Oe.unstable_renderSubtreeIntoContainer = function (e, t, n, r) {
  if (!za(n)) throw Error(C(200));
  if (e == null || e._reactInternals === void 0) throw Error(C(38));
  return Ba(e, t, n, !1, r);
};
Oe.version = '18.3.1-next-f1338f8080-20240426';
function Wf() {
  if (!(
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > 'u' ||
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != 'function'
  ))
    try {
      __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Wf);
    } catch (e) {
      console.error(e);
    }
}
(Wf(), (Hc.exports = Oe));
var Tg = Hc.exports,
  Qf,
  hc = Tg;
((Qf = hc.createRoot), hc.hydrateRoot);
/**
 * @remix-run/router v1.23.0
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */ function Gr() {
  return (
    (Gr = Object.assign
      ? Object.assign.bind()
      : function (e) {
          for (var t = 1; t < arguments.length; t++) {
            var n = arguments[t];
            for (var r in n) Object.prototype.hasOwnProperty.call(n, r) && (e[r] = n[r]);
          }
          return e;
        }),
    Gr.apply(this, arguments)
  );
}
var At;
(function (e) {
  ((e.Pop = 'POP'), (e.Push = 'PUSH'), (e.Replace = 'REPLACE'));
})(At || (At = {}));
const mc = 'popstate';
function Lg(e) {
  e === void 0 && (e = {});
  function t(r, l) {
    let { pathname: a, search: o, hash: s } = r.location;
    return _i(
      '',
      { pathname: a, search: o, hash: s },
      (l.state && l.state.usr) || null,
      (l.state && l.state.key) || 'default',
    );
  }
  function n(r, l) {
    return typeof l == 'string' ? l : wa(l);
  }
  return bg(t, n, null, e);
}
function K(e, t) {
  if (e === !1 || e === null || typeof e > 'u') throw new Error(t);
}
function Kf(e, t) {
  if (!e) {
    typeof console < 'u' && console.warn(t);
    try {
      throw new Error(t);
    } catch {}
  }
}
function Rg() {
  return Math.random().toString(36).substr(2, 8);
}
function gc(e, t) {
  return { usr: e.state, key: e.key, idx: t };
}
function _i(e, t, n, r) {
  return (
    n === void 0 && (n = null),
    Gr(
      { pathname: typeof e == 'string' ? e : e.pathname, search: '', hash: '' },
      typeof t == 'string' ? or(t) : t,
      { state: n, key: (t && t.key) || r || Rg() },
    )
  );
}
function wa(e) {
  let { pathname: t = '/', search: n = '', hash: r = '' } = e;
  return (
    n && n !== '?' && (t += n.charAt(0) === '?' ? n : '?' + n),
    r && r !== '#' && (t += r.charAt(0) === '#' ? r : '#' + r),
    t
  );
}
function or(e) {
  let t = {};
  if (e) {
    let n = e.indexOf('#');
    n >= 0 && ((t.hash = e.substr(n)), (e = e.substr(0, n)));
    let r = e.indexOf('?');
    (r >= 0 && ((t.search = e.substr(r)), (e = e.substr(0, r))), e && (t.pathname = e));
  }
  return t;
}
function bg(e, t, n, r) {
  r === void 0 && (r = {});
  let { window: l = document.defaultView, v5Compat: a = !1 } = r,
    o = l.history,
    s = At.Pop,
    u = null,
    c = m();
  c == null && ((c = 0), o.replaceState(Gr({}, o.state, { idx: c }), ''));
  function m() {
    return (o.state || { idx: null }).idx;
  }
  function d() {
    s = At.Pop;
    let j = m(),
      h = j == null ? null : j - c;
    ((c = j), u && u({ action: s, location: w.location, delta: h }));
  }
  function f(j, h) {
    s = At.Push;
    let p = _i(w.location, j, h);
    c = m() + 1;
    let g = gc(p, c),
      y = w.createHref(p);
    try {
      o.pushState(g, '', y);
    } catch (S) {
      if (S instanceof DOMException && S.name === 'DataCloneError') throw S;
      l.location.assign(y);
    }
    a && u && u({ action: s, location: w.location, delta: 1 });
  }
  function v(j, h) {
    s = At.Replace;
    let p = _i(w.location, j, h);
    c = m();
    let g = gc(p, c),
      y = w.createHref(p);
    (o.replaceState(g, '', y), a && u && u({ action: s, location: w.location, delta: 0 }));
  }
  function k(j) {
    let h = l.location.origin !== 'null' ? l.location.origin : l.location.href,
      p = typeof j == 'string' ? j : wa(j);
    return (
      (p = p.replace(/ $/, '%20')),
      K(h, 'No window.location.(origin|href) available to create URL for href: ' + p),
      new URL(p, h)
    );
  }
  let w = {
    get action() {
      return s;
    },
    get location() {
      return e(l, o);
    },
    listen(j) {
      if (u) throw new Error('A history only accepts one active listener');
      return (
        l.addEventListener(mc, d),
        (u = j),
        () => {
          (l.removeEventListener(mc, d), (u = null));
        }
      );
    },
    createHref(j) {
      return t(l, j);
    },
    createURL: k,
    encodeLocation(j) {
      let h = k(j);
      return { pathname: h.pathname, search: h.search, hash: h.hash };
    },
    push: f,
    replace: v,
    go(j) {
      return o.go(j);
    },
  };
  return w;
}
var vc;
(function (e) {
  ((e.data = 'data'), (e.deferred = 'deferred'), (e.redirect = 'redirect'), (e.error = 'error'));
})(vc || (vc = {}));
function Mg(e, t, n) {
  return (n === void 0 && (n = '/'), Og(e, t, n));
}
function Og(e, t, n, r) {
  let l = typeof t == 'string' ? or(t) : t,
    a = Jn(l.pathname || '/', n);
  if (a == null) return null;
  let o = qf(e);
  Ig(o);
  let s = null;
  for (let u = 0; s == null && u < o.length; ++u) {
    let c = Qg(a);
    s = Hg(o[u], c);
  }
  return s;
}
function qf(e, t, n, r) {
  (t === void 0 && (t = []), n === void 0 && (n = []), r === void 0 && (r = ''));
  let l = (a, o, s) => {
    let u = {
      relativePath: s === void 0 ? a.path || '' : s,
      caseSensitive: a.caseSensitive === !0,
      childrenIndex: o,
      route: a,
    };
    u.relativePath.startsWith('/') &&
      (K(
        u.relativePath.startsWith(r),
        'Absolute route path "' +
          u.relativePath +
          '" nested under path ' +
          ('"' + r + '" is not valid. An absolute child route path ') +
          'must start with the combined path of all its parent routes.',
      ),
      (u.relativePath = u.relativePath.slice(r.length)));
    let c = Qt([r, u.relativePath]),
      m = n.concat(u);
    (a.children &&
      a.children.length > 0 &&
      (K(
        a.index !== !0,
        'Index routes must not have child routes. Please remove ' +
          ('all child routes from route path "' + c + '".'),
      ),
      qf(a.children, t, m, c)),
      !(a.path == null && !a.index) && t.push({ path: c, score: Ug(c, a.index), routesMeta: m }));
  };
  return (
    e.forEach((a, o) => {
      var s;
      if (a.path === '' || !((s = a.path) != null && s.includes('?'))) l(a, o);
      else for (let u of Yf(a.path)) l(a, o, u);
    }),
    t
  );
}
function Yf(e) {
  let t = e.split('/');
  if (t.length === 0) return [];
  let [n, ...r] = t,
    l = n.endsWith('?'),
    a = n.replace(/\?$/, '');
  if (r.length === 0) return l ? [a, ''] : [a];
  let o = Yf(r.join('/')),
    s = [];
  return (
    s.push(...o.map((u) => (u === '' ? a : [a, u].join('/')))),
    l && s.push(...o),
    s.map((u) => (e.startsWith('/') && u === '' ? '/' : u))
  );
}
function Ig(e) {
  e.sort((t, n) =>
    t.score !== n.score
      ? n.score - t.score
      : Vg(
          t.routesMeta.map((r) => r.childrenIndex),
          n.routesMeta.map((r) => r.childrenIndex),
        ),
  );
}
const Ag = /^:[\w-]+$/,
  Dg = 3,
  zg = 2,
  Bg = 1,
  Fg = 10,
  $g = -2,
  yc = (e) => e === '*';
function Ug(e, t) {
  let n = e.split('/'),
    r = n.length;
  return (
    n.some(yc) && (r += $g),
    t && (r += zg),
    n.filter((l) => !yc(l)).reduce((l, a) => l + (Ag.test(a) ? Dg : a === '' ? Bg : Fg), r)
  );
}
function Vg(e, t) {
  return e.length === t.length && e.slice(0, -1).every((r, l) => r === t[l])
    ? e[e.length - 1] - t[t.length - 1]
    : 0;
}
function Hg(e, t, n) {
  let { routesMeta: r } = e,
    l = {},
    a = '/',
    o = [];
  for (let s = 0; s < r.length; ++s) {
    let u = r[s],
      c = s === r.length - 1,
      m = a === '/' ? t : t.slice(a.length) || '/',
      d = Pi({ path: u.relativePath, caseSensitive: u.caseSensitive, end: c }, m),
      f = u.route;
    if (!d) return null;
    (Object.assign(l, d.params),
      o.push({
        params: l,
        pathname: Qt([a, d.pathname]),
        pathnameBase: Jg(Qt([a, d.pathnameBase])),
        route: f,
      }),
      d.pathnameBase !== '/' && (a = Qt([a, d.pathnameBase])));
  }
  return o;
}
function Pi(e, t) {
  typeof e == 'string' && (e = { path: e, caseSensitive: !1, end: !0 });
  let [n, r] = Wg(e.path, e.caseSensitive, e.end),
    l = t.match(n);
  if (!l) return null;
  let a = l[0],
    o = a.replace(/(.)\/+$/, '$1'),
    s = l.slice(1);
  return {
    params: r.reduce((c, m, d) => {
      let { paramName: f, isOptional: v } = m;
      if (f === '*') {
        let w = s[d] || '';
        o = a.slice(0, a.length - w.length).replace(/(.)\/+$/, '$1');
      }
      const k = s[d];
      return (v && !k ? (c[f] = void 0) : (c[f] = (k || '').replace(/%2F/g, '/')), c);
    }, {}),
    pathname: a,
    pathnameBase: o,
    pattern: e,
  };
}
function Wg(e, t, n) {
  (t === void 0 && (t = !1),
    n === void 0 && (n = !0),
    Kf(
      e === '*' || !e.endsWith('*') || e.endsWith('/*'),
      'Route path "' +
        e +
        '" will be treated as if it were ' +
        ('"' + e.replace(/\*$/, '/*') + '" because the `*` character must ') +
        'always follow a `/` in the pattern. To get rid of this warning, ' +
        ('please change the route path to "' + e.replace(/\*$/, '/*') + '".'),
    ));
  let r = [],
    l =
      '^' +
      e
        .replace(/\/*\*?$/, '')
        .replace(/^\/*/, '/')
        .replace(/[\\.*+^${}|()[\]]/g, '\\$&')
        .replace(
          /\/:([\w-]+)(\?)?/g,
          (o, s, u) => (
            r.push({ paramName: s, isOptional: u != null }),
            u ? '/?([^\\/]+)?' : '/([^\\/]+)'
          ),
        );
  return (
    e.endsWith('*')
      ? (r.push({ paramName: '*' }), (l += e === '*' || e === '/*' ? '(.*)$' : '(?:\\/(.+)|\\/*)$'))
      : n
        ? (l += '\\/*$')
        : e !== '' && e !== '/' && (l += '(?:(?=\\/|$))'),
    [new RegExp(l, t ? void 0 : 'i'), r]
  );
}
function Qg(e) {
  try {
    return e
      .split('/')
      .map((t) => decodeURIComponent(t).replace(/\//g, '%2F'))
      .join('/');
  } catch (t) {
    return (
      Kf(
        !1,
        'The URL path "' +
          e +
          '" could not be decoded because it is is a malformed URL segment. This is probably due to a bad percent ' +
          ('encoding (' + t + ').'),
      ),
      e
    );
  }
}
function Jn(e, t) {
  if (t === '/') return e;
  if (!e.toLowerCase().startsWith(t.toLowerCase())) return null;
  let n = t.endsWith('/') ? t.length - 1 : t.length,
    r = e.charAt(n);
  return r && r !== '/' ? null : e.slice(n) || '/';
}
function Kg(e, t) {
  t === void 0 && (t = '/');
  let { pathname: n, search: r = '', hash: l = '' } = typeof e == 'string' ? or(e) : e;
  return { pathname: n ? (n.startsWith('/') ? n : qg(n, t)) : t, search: Gg(r), hash: Xg(l) };
}
function qg(e, t) {
  let n = t.replace(/\/+$/, '').split('/');
  return (
    e.split('/').forEach((l) => {
      l === '..' ? n.length > 1 && n.pop() : l !== '.' && n.push(l);
    }),
    n.length > 1 ? n.join('/') : '/'
  );
}
function _o(e, t, n, r) {
  return (
    "Cannot include a '" +
    e +
    "' character in a manually specified " +
    ('`to.' + t + '` field [' + JSON.stringify(r) + '].  Please separate it out to the ') +
    ('`to.' + n + '` field. Alternatively you may provide the full path as ') +
    'a string in <Link to="..."> and the router will parse it for you.'
  );
}
function Yg(e) {
  return e.filter((t, n) => n === 0 || (t.route.path && t.route.path.length > 0));
}
function Ds(e, t) {
  let n = Yg(e);
  return t
    ? n.map((r, l) => (l === n.length - 1 ? r.pathname : r.pathnameBase))
    : n.map((r) => r.pathnameBase);
}
function zs(e, t, n, r) {
  r === void 0 && (r = !1);
  let l;
  typeof e == 'string'
    ? (l = or(e))
    : ((l = Gr({}, e)),
      K(!l.pathname || !l.pathname.includes('?'), _o('?', 'pathname', 'search', l)),
      K(!l.pathname || !l.pathname.includes('#'), _o('#', 'pathname', 'hash', l)),
      K(!l.search || !l.search.includes('#'), _o('#', 'search', 'hash', l)));
  let a = e === '' || l.pathname === '',
    o = a ? '/' : l.pathname,
    s;
  if (o == null) s = n;
  else {
    let d = t.length - 1;
    if (!r && o.startsWith('..')) {
      let f = o.split('/');
      for (; f[0] === '..';) (f.shift(), (d -= 1));
      l.pathname = f.join('/');
    }
    s = d >= 0 ? t[d] : '/';
  }
  let u = Kg(l, s),
    c = o && o !== '/' && o.endsWith('/'),
    m = (a || o === '.') && n.endsWith('/');
  return (!u.pathname.endsWith('/') && (c || m) && (u.pathname += '/'), u);
}
const Qt = (e) => e.join('/').replace(/\/\/+/g, '/'),
  Jg = (e) => e.replace(/\/+$/, '').replace(/^\/*/, '/'),
  Gg = (e) => (!e || e === '?' ? '' : e.startsWith('?') ? e : '?' + e),
  Xg = (e) => (!e || e === '#' ? '' : e.startsWith('#') ? e : '#' + e);
function Zg(e) {
  return (
    e != null &&
    typeof e.status == 'number' &&
    typeof e.statusText == 'string' &&
    typeof e.internal == 'boolean' &&
    'data' in e
  );
}
const Jf = ['post', 'put', 'patch', 'delete'];
new Set(Jf);
const ev = ['get', ...Jf];
new Set(ev);
/**
 * React Router v6.30.0
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */ function Xr() {
  return (
    (Xr = Object.assign
      ? Object.assign.bind()
      : function (e) {
          for (var t = 1; t < arguments.length; t++) {
            var n = arguments[t];
            for (var r in n) Object.prototype.hasOwnProperty.call(n, r) && (e[r] = n[r]);
          }
          return e;
        }),
    Xr.apply(this, arguments)
  );
}
const Fa = x.createContext(null),
  Gf = x.createContext(null),
  dt = x.createContext(null),
  $a = x.createContext(null),
  ft = x.createContext({ outlet: null, matches: [], isDataRoute: !1 }),
  Xf = x.createContext(null);
function tv(e, t) {
  let { relative: n } = t === void 0 ? {} : t;
  ir() || K(!1);
  let { basename: r, navigator: l } = x.useContext(dt),
    { hash: a, pathname: o, search: s } = Va(e, { relative: n }),
    u = o;
  return (
    r !== '/' && (u = o === '/' ? r : Qt([r, o])),
    l.createHref({ pathname: u, search: s, hash: a })
  );
}
function ir() {
  return x.useContext($a) != null;
}
function nt() {
  return (ir() || K(!1), x.useContext($a).location);
}
function Zf(e) {
  x.useContext(dt).static || x.useLayoutEffect(e);
}
function Ua() {
  let { isDataRoute: e } = x.useContext(ft);
  return e ? gv() : nv();
}
function nv() {
  ir() || K(!1);
  let e = x.useContext(Fa),
    { basename: t, future: n, navigator: r } = x.useContext(dt),
    { matches: l } = x.useContext(ft),
    { pathname: a } = nt(),
    o = JSON.stringify(Ds(l, n.v7_relativeSplatPath)),
    s = x.useRef(!1);
  return (
    Zf(() => {
      s.current = !0;
    }),
    x.useCallback(
      function (c, m) {
        if ((m === void 0 && (m = {}), !s.current)) return;
        if (typeof c == 'number') {
          r.go(c);
          return;
        }
        let d = zs(c, JSON.parse(o), a, m.relative === 'path');
        (e == null && t !== '/' && (d.pathname = d.pathname === '/' ? t : Qt([t, d.pathname])),
          (m.replace ? r.replace : r.push)(d, m.state, m));
      },
      [t, r, o, a, e],
    )
  );
}
const rv = x.createContext(null);
function lv(e) {
  let t = x.useContext(ft).outlet;
  return t && x.createElement(rv.Provider, { value: e }, t);
}
function ep() {
  let { matches: e } = x.useContext(ft),
    t = e[e.length - 1];
  return t ? t.params : {};
}
function Va(e, t) {
  let { relative: n } = t === void 0 ? {} : t,
    { future: r } = x.useContext(dt),
    { matches: l } = x.useContext(ft),
    { pathname: a } = nt(),
    o = JSON.stringify(Ds(l, r.v7_relativeSplatPath));
  return x.useMemo(() => zs(e, JSON.parse(o), a, n === 'path'), [e, o, a, n]);
}
function av(e, t) {
  return ov(e, t);
}
function ov(e, t, n, r) {
  ir() || K(!1);
  let { navigator: l, static: a } = x.useContext(dt),
    { matches: o } = x.useContext(ft),
    s = o[o.length - 1],
    u = s ? s.params : {};
  s && s.pathname;
  let c = s ? s.pathnameBase : '/';
  s && s.route;
  let m = nt(),
    d;
  if (t) {
    var f;
    let h = typeof t == 'string' ? or(t) : t;
    (c === '/' || ((f = h.pathname) != null && f.startsWith(c)) || K(!1), (d = h));
  } else d = m;
  let v = d.pathname || '/',
    k = v;
  if (c !== '/') {
    let h = c.replace(/^\//, '').split('/');
    k = '/' + v.replace(/^\//, '').split('/').slice(h.length).join('/');
  }
  let w = Mg(e, { pathname: k }),
    j = dv(
      w &&
        w.map((h) =>
          Object.assign({}, h, {
            params: Object.assign({}, u, h.params),
            pathname: Qt([
              c,
              l.encodeLocation ? l.encodeLocation(h.pathname).pathname : h.pathname,
            ]),
            pathnameBase:
              h.pathnameBase === '/'
                ? c
                : Qt([
                    c,
                    l.encodeLocation ? l.encodeLocation(h.pathnameBase).pathname : h.pathnameBase,
                  ]),
          }),
        ),
      o,
      n,
      r,
    );
  return t && j
    ? x.createElement(
        $a.Provider,
        {
          value: {
            location: Xr({ pathname: '/', search: '', hash: '', state: null, key: 'default' }, d),
            navigationType: At.Pop,
          },
        },
        j,
      )
    : j;
}
function iv() {
  let e = mv(),
    t = Zg(e) ? e.status + ' ' + e.statusText : e instanceof Error ? e.message : JSON.stringify(e),
    n = e instanceof Error ? e.stack : null,
    l = { padding: '0.5rem', backgroundColor: 'rgba(200,200,200, 0.5)' };
  return x.createElement(
    x.Fragment,
    null,
    x.createElement('h2', null, 'Unexpected Application Error!'),
    x.createElement('h3', { style: { fontStyle: 'italic' } }, t),
    n ? x.createElement('pre', { style: l }, n) : null,
    null,
  );
}
const sv = x.createElement(iv, null);
class uv extends x.Component {
  constructor(t) {
    (super(t),
      (this.state = { location: t.location, revalidation: t.revalidation, error: t.error }));
  }
  static getDerivedStateFromError(t) {
    return { error: t };
  }
  static getDerivedStateFromProps(t, n) {
    return n.location !== t.location || (n.revalidation !== 'idle' && t.revalidation === 'idle')
      ? { error: t.error, location: t.location, revalidation: t.revalidation }
      : {
          error: t.error !== void 0 ? t.error : n.error,
          location: n.location,
          revalidation: t.revalidation || n.revalidation,
        };
  }
  componentDidCatch(t, n) {
    console.error('React Router caught the following error during render', t, n);
  }
  render() {
    return this.state.error !== void 0
      ? x.createElement(
          ft.Provider,
          { value: this.props.routeContext },
          x.createElement(Xf.Provider, { value: this.state.error, children: this.props.component }),
        )
      : this.props.children;
  }
}
function cv(e) {
  let { routeContext: t, match: n, children: r } = e,
    l = x.useContext(Fa);
  return (
    l &&
      l.static &&
      l.staticContext &&
      (n.route.errorElement || n.route.ErrorBoundary) &&
      (l.staticContext._deepestRenderedBoundaryId = n.route.id),
    x.createElement(ft.Provider, { value: t }, r)
  );
}
function dv(e, t, n, r) {
  var l;
  if (
    (t === void 0 && (t = []), n === void 0 && (n = null), r === void 0 && (r = null), e == null)
  ) {
    var a;
    if (!n) return null;
    if (n.errors) e = n.matches;
    else if (
      (a = r) != null &&
      a.v7_partialHydration &&
      t.length === 0 &&
      !n.initialized &&
      n.matches.length > 0
    )
      e = n.matches;
    else return null;
  }
  let o = e,
    s = (l = n) == null ? void 0 : l.errors;
  if (s != null) {
    let m = o.findIndex((d) => d.route.id && (s == null ? void 0 : s[d.route.id]) !== void 0);
    (m >= 0 || K(!1), (o = o.slice(0, Math.min(o.length, m + 1))));
  }
  let u = !1,
    c = -1;
  if (n && r && r.v7_partialHydration)
    for (let m = 0; m < o.length; m++) {
      let d = o[m];
      if (((d.route.HydrateFallback || d.route.hydrateFallbackElement) && (c = m), d.route.id)) {
        let { loaderData: f, errors: v } = n,
          k = d.route.loader && f[d.route.id] === void 0 && (!v || v[d.route.id] === void 0);
        if (d.route.lazy || k) {
          ((u = !0), c >= 0 ? (o = o.slice(0, c + 1)) : (o = [o[0]]));
          break;
        }
      }
    }
  return o.reduceRight((m, d, f) => {
    let v,
      k = !1,
      w = null,
      j = null;
    n &&
      ((v = s && d.route.id ? s[d.route.id] : void 0),
      (w = d.route.errorElement || sv),
      u &&
        (c < 0 && f === 0
          ? (vv('route-fallback'), (k = !0), (j = null))
          : c === f && ((k = !0), (j = d.route.hydrateFallbackElement || null))));
    let h = t.concat(o.slice(0, f + 1)),
      p = () => {
        let g;
        return (
          v
            ? (g = w)
            : k
              ? (g = j)
              : d.route.Component
                ? (g = x.createElement(d.route.Component, null))
                : d.route.element
                  ? (g = d.route.element)
                  : (g = m),
          x.createElement(cv, {
            match: d,
            routeContext: { outlet: m, matches: h, isDataRoute: n != null },
            children: g,
          })
        );
      };
    return n && (d.route.ErrorBoundary || d.route.errorElement || f === 0)
      ? x.createElement(uv, {
          location: n.location,
          revalidation: n.revalidation,
          component: w,
          error: v,
          children: p(),
          routeContext: { outlet: null, matches: h, isDataRoute: !0 },
        })
      : p();
  }, null);
}
var tp = (function (e) {
    return (
      (e.UseBlocker = 'useBlocker'),
      (e.UseRevalidator = 'useRevalidator'),
      (e.UseNavigateStable = 'useNavigate'),
      e
    );
  })(tp || {}),
  np = (function (e) {
    return (
      (e.UseBlocker = 'useBlocker'),
      (e.UseLoaderData = 'useLoaderData'),
      (e.UseActionData = 'useActionData'),
      (e.UseRouteError = 'useRouteError'),
      (e.UseNavigation = 'useNavigation'),
      (e.UseRouteLoaderData = 'useRouteLoaderData'),
      (e.UseMatches = 'useMatches'),
      (e.UseRevalidator = 'useRevalidator'),
      (e.UseNavigateStable = 'useNavigate'),
      (e.UseRouteId = 'useRouteId'),
      e
    );
  })(np || {});
function fv(e) {
  let t = x.useContext(Fa);
  return (t || K(!1), t);
}
function pv(e) {
  let t = x.useContext(Gf);
  return (t || K(!1), t);
}
function hv(e) {
  let t = x.useContext(ft);
  return (t || K(!1), t);
}
function rp(e) {
  let t = hv(),
    n = t.matches[t.matches.length - 1];
  return (n.route.id || K(!1), n.route.id);
}
function mv() {
  var e;
  let t = x.useContext(Xf),
    n = pv(),
    r = rp();
  return t !== void 0 ? t : (e = n.errors) == null ? void 0 : e[r];
}
function gv() {
  let { router: e } = fv(tp.UseNavigateStable),
    t = rp(np.UseNavigateStable),
    n = x.useRef(!1);
  return (
    Zf(() => {
      n.current = !0;
    }),
    x.useCallback(
      function (l, a) {
        (a === void 0 && (a = {}),
          n.current &&
            (typeof l == 'number' ? e.navigate(l) : e.navigate(l, Xr({ fromRouteId: t }, a))));
      },
      [e, t],
    )
  );
}
const xc = {};
function vv(e, t, n) {
  xc[e] || (xc[e] = !0);
}
function yv(e, t) {
  (e == null || e.v7_startTransition, e == null || e.v7_relativeSplatPath);
}
function xv(e) {
  let { to: t, replace: n, state: r, relative: l } = e;
  ir() || K(!1);
  let { future: a, static: o } = x.useContext(dt),
    { matches: s } = x.useContext(ft),
    { pathname: u } = nt(),
    c = Ua(),
    m = zs(t, Ds(s, a.v7_relativeSplatPath), u, l === 'path'),
    d = JSON.stringify(m);
  return (
    x.useEffect(() => c(JSON.parse(d), { replace: n, state: r, relative: l }), [c, d, l, n, r]),
    null
  );
}
function wv(e) {
  return lv(e.context);
}
function ze(e) {
  K(!1);
}
function kv(e) {
  let {
    basename: t = '/',
    children: n = null,
    location: r,
    navigationType: l = At.Pop,
    navigator: a,
    static: o = !1,
    future: s,
  } = e;
  ir() && K(!1);
  let u = t.replace(/^\/*/, '/'),
    c = x.useMemo(
      () => ({ basename: u, navigator: a, static: o, future: Xr({ v7_relativeSplatPath: !1 }, s) }),
      [u, s, a, o],
    );
  typeof r == 'string' && (r = or(r));
  let { pathname: m = '/', search: d = '', hash: f = '', state: v = null, key: k = 'default' } = r,
    w = x.useMemo(() => {
      let j = Jn(m, u);
      return j == null
        ? null
        : { location: { pathname: j, search: d, hash: f, state: v, key: k }, navigationType: l };
    }, [u, m, d, f, v, k, l]);
  return w == null
    ? null
    : x.createElement(
        dt.Provider,
        { value: c },
        x.createElement($a.Provider, { children: n, value: w }),
      );
}
function jv(e) {
  let { children: t, location: n } = e;
  return av(Ti(t), n);
}
new Promise(() => {});
function Ti(e, t) {
  t === void 0 && (t = []);
  let n = [];
  return (
    x.Children.forEach(e, (r, l) => {
      if (!x.isValidElement(r)) return;
      let a = [...t, l];
      if (r.type === x.Fragment) {
        n.push.apply(n, Ti(r.props.children, a));
        return;
      }
      (r.type !== ze && K(!1), !r.props.index || !r.props.children || K(!1));
      let o = {
        id: r.props.id || a.join('-'),
        caseSensitive: r.props.caseSensitive,
        element: r.props.element,
        Component: r.props.Component,
        index: r.props.index,
        path: r.props.path,
        loader: r.props.loader,
        action: r.props.action,
        errorElement: r.props.errorElement,
        ErrorBoundary: r.props.ErrorBoundary,
        hasErrorBoundary: r.props.ErrorBoundary != null || r.props.errorElement != null,
        shouldRevalidate: r.props.shouldRevalidate,
        handle: r.props.handle,
        lazy: r.props.lazy,
      };
      (r.props.children && (o.children = Ti(r.props.children, a)), n.push(o));
    }),
    n
  );
}
/**
 * React Router DOM v6.30.0
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */ function ka() {
  return (
    (ka = Object.assign
      ? Object.assign.bind()
      : function (e) {
          for (var t = 1; t < arguments.length; t++) {
            var n = arguments[t];
            for (var r in n) Object.prototype.hasOwnProperty.call(n, r) && (e[r] = n[r]);
          }
          return e;
        }),
    ka.apply(this, arguments)
  );
}
function lp(e, t) {
  if (e == null) return {};
  var n = {},
    r = Object.keys(e),
    l,
    a;
  for (a = 0; a < r.length; a++) ((l = r[a]), !(t.indexOf(l) >= 0) && (n[l] = e[l]));
  return n;
}
function Sv(e) {
  return !!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
}
function Nv(e, t) {
  return e.button === 0 && (!t || t === '_self') && !Sv(e);
}
function Li(e) {
  return (
    e === void 0 && (e = ''),
    new URLSearchParams(
      typeof e == 'string' || Array.isArray(e) || e instanceof URLSearchParams
        ? e
        : Object.keys(e).reduce((t, n) => {
            let r = e[n];
            return t.concat(Array.isArray(r) ? r.map((l) => [n, l]) : [[n, r]]);
          }, []),
    )
  );
}
function Cv(e, t) {
  let n = Li(e);
  return (
    t &&
      t.forEach((r, l) => {
        n.has(l) ||
          t.getAll(l).forEach((a) => {
            n.append(l, a);
          });
      }),
    n
  );
}
const Ev = [
    'onClick',
    'relative',
    'reloadDocument',
    'replace',
    'state',
    'target',
    'to',
    'preventScrollReset',
    'viewTransition',
  ],
  _v = [
    'aria-current',
    'caseSensitive',
    'className',
    'end',
    'style',
    'to',
    'viewTransition',
    'children',
  ],
  Pv = '6';
try {
  window.__reactRouterVersion = Pv;
} catch {}
const Tv = x.createContext({ isTransitioning: !1 }),
  Lv = 'startTransition',
  wc = yh[Lv];
function Rv(e) {
  let { basename: t, children: n, future: r, window: l } = e,
    a = x.useRef();
  a.current == null && (a.current = Lg({ window: l, v5Compat: !0 }));
  let o = a.current,
    [s, u] = x.useState({ action: o.action, location: o.location }),
    { v7_startTransition: c } = r || {},
    m = x.useCallback(
      (d) => {
        c && wc ? wc(() => u(d)) : u(d);
      },
      [u, c],
    );
  return (
    x.useLayoutEffect(() => o.listen(m), [o, m]),
    x.useEffect(() => yv(r), [r]),
    x.createElement(kv, {
      basename: t,
      children: n,
      location: s.location,
      navigationType: s.action,
      navigator: o,
      future: r,
    })
  );
}
const bv =
    typeof window < 'u' &&
    typeof window.document < 'u' &&
    typeof window.document.createElement < 'u',
  Mv = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i,
  ut = x.forwardRef(function (t, n) {
    let {
        onClick: r,
        relative: l,
        reloadDocument: a,
        replace: o,
        state: s,
        target: u,
        to: c,
        preventScrollReset: m,
        viewTransition: d,
      } = t,
      f = lp(t, Ev),
      { basename: v } = x.useContext(dt),
      k,
      w = !1;
    if (typeof c == 'string' && Mv.test(c) && ((k = c), bv))
      try {
        let g = new URL(window.location.href),
          y = c.startsWith('//') ? new URL(g.protocol + c) : new URL(c),
          S = Jn(y.pathname, v);
        y.origin === g.origin && S != null ? (c = S + y.search + y.hash) : (w = !0);
      } catch {}
    let j = tv(c, { relative: l }),
      h = Av(c, {
        replace: o,
        state: s,
        target: u,
        preventScrollReset: m,
        relative: l,
        viewTransition: d,
      });
    function p(g) {
      (r && r(g), g.defaultPrevented || h(g));
    }
    return x.createElement(
      'a',
      ka({}, f, { href: k || j, onClick: w || a ? r : p, ref: n, target: u }),
    );
  }),
  Ov = x.forwardRef(function (t, n) {
    let {
        'aria-current': r = 'page',
        caseSensitive: l = !1,
        className: a = '',
        end: o = !1,
        style: s,
        to: u,
        viewTransition: c,
        children: m,
      } = t,
      d = lp(t, _v),
      f = Va(u, { relative: d.relative }),
      v = nt(),
      k = x.useContext(Gf),
      { navigator: w, basename: j } = x.useContext(dt),
      h = k != null && zv(f) && c === !0,
      p = w.encodeLocation ? w.encodeLocation(f).pathname : f.pathname,
      g = v.pathname,
      y = k && k.navigation && k.navigation.location ? k.navigation.location.pathname : null;
    (l || ((g = g.toLowerCase()), (y = y ? y.toLowerCase() : null), (p = p.toLowerCase())),
      y && j && (y = Jn(y, j) || y));
    const S = p !== '/' && p.endsWith('/') ? p.length - 1 : p.length;
    let N = g === p || (!o && g.startsWith(p) && g.charAt(S) === '/'),
      _ = y != null && (y === p || (!o && y.startsWith(p) && y.charAt(p.length) === '/')),
      P = { isActive: N, isPending: _, isTransitioning: h },
      I = N ? r : void 0,
      T;
    typeof a == 'function'
      ? (T = a(P))
      : (T = [a, N ? 'active' : null, _ ? 'pending' : null, h ? 'transitioning' : null]
          .filter(Boolean)
          .join(' '));
    let b = typeof s == 'function' ? s(P) : s;
    return x.createElement(
      ut,
      ka({}, d, { 'aria-current': I, className: T, ref: n, style: b, to: u, viewTransition: c }),
      typeof m == 'function' ? m(P) : m,
    );
  });
var Ri;
(function (e) {
  ((e.UseScrollRestoration = 'useScrollRestoration'),
    (e.UseSubmit = 'useSubmit'),
    (e.UseSubmitFetcher = 'useSubmitFetcher'),
    (e.UseFetcher = 'useFetcher'),
    (e.useViewTransitionState = 'useViewTransitionState'));
})(Ri || (Ri = {}));
var kc;
(function (e) {
  ((e.UseFetcher = 'useFetcher'),
    (e.UseFetchers = 'useFetchers'),
    (e.UseScrollRestoration = 'useScrollRestoration'));
})(kc || (kc = {}));
function Iv(e) {
  let t = x.useContext(Fa);
  return (t || K(!1), t);
}
function Av(e, t) {
  let {
      target: n,
      replace: r,
      state: l,
      preventScrollReset: a,
      relative: o,
      viewTransition: s,
    } = t === void 0 ? {} : t,
    u = Ua(),
    c = nt(),
    m = Va(e, { relative: o });
  return x.useCallback(
    (d) => {
      if (Nv(d, n)) {
        d.preventDefault();
        let f = r !== void 0 ? r : wa(c) === wa(m);
        u(e, { replace: f, state: l, preventScrollReset: a, relative: o, viewTransition: s });
      }
    },
    [c, u, m, r, l, n, e, a, o, s],
  );
}
function Dv(e) {
  let t = x.useRef(Li(e)),
    n = x.useRef(!1),
    r = nt(),
    l = x.useMemo(() => Cv(r.search, n.current ? null : t.current), [r.search]),
    a = Ua(),
    o = x.useCallback(
      (s, u) => {
        const c = Li(typeof s == 'function' ? s(l) : s);
        ((n.current = !0), a('?' + c, u));
      },
      [a, l],
    );
  return [l, o];
}
function zv(e, t) {
  t === void 0 && (t = {});
  let n = x.useContext(Tv);
  n == null && K(!1);
  let { basename: r } = Iv(Ri.useViewTransitionState),
    l = Va(e, { relative: t.relative });
  if (!n.isTransitioning) return !1;
  let a = Jn(n.currentLocation.pathname, r) || n.currentLocation.pathname,
    o = Jn(n.nextLocation.pathname, r) || n.nextLocation.pathname;
  return Pi(l.pathname, o) != null || Pi(l.pathname, a) != null;
}
const Bv = { 'system.StorePausedNotice': { to: 'system.PauseNotice', codemod: 'c3-rehearsal' } };
const ot = { cart: '/sacola', checkout: '/checkout', order: '/pedido/:id', orders: '/pedidos' };
function Gn(e) {
  var t, n;
  return {
    home: '/',
    catalog: ((t = e.paths) == null ? void 0 : t.catalog) ?? '/cardapio',
    product: ((n = e.paths) == null ? void 0 : n.product) ?? '/produto/:slug',
    ...ot,
  };
}
function ap(e, t) {
  return Gn(e).product.replace(':slug', encodeURIComponent(t));
}
class Zr extends Error {
  constructor(t, n, r, l) {
    (super(r), (this.status = t), (this.code = n), (this.details = l));
  }
}
const Bs = 'vendua.session',
  op = 'vendua.orderTokens';
function bi() {
  var e;
  try {
    return JSON.parse(((e = globalThis.sessionStorage) == null ? void 0 : e.getItem(op)) ?? '{}');
  } catch {
    return {};
  }
}
function Fv(e, t) {
  var n;
  try {
    const r = bi();
    r[e] = t;
    for (const l of Object.keys(r).slice(0, -20)) delete r[l];
    (n = globalThis.sessionStorage) == null || n.setItem(op, JSON.stringify(r));
  } catch {}
}
function $v() {
  var e;
  try {
    return ((e = globalThis.sessionStorage) == null ? void 0 : e.getItem(Bs)) ?? null;
  } catch {
    return null;
  }
}
function Uv(e) {
  var t;
  try {
    (t = globalThis.sessionStorage) == null || t.setItem(Bs, e);
  } catch {}
}
async function ge(e, t) {
  let n;
  try {
    n = await fetch(e, {
      ...t,
      headers: { 'content-type': 'application/json', ...((t == null ? void 0 : t.headers) ?? {}) },
    });
  } catch {
    throw new Zr(0, 'NETWORK_ERROR', 'could not reach the store backend');
  }
  const r = await n.json().catch(() => ({}));
  if (!n.ok) {
    const l = r == null ? void 0 : r.error;
    throw new Zr(
      n.status,
      (l == null ? void 0 : l.code) ?? 'INTERNAL',
      (l == null ? void 0 : l.message) ?? n.statusText,
      l == null ? void 0 : l.details,
    );
  }
  return r;
}
function Tt() {
  var e, t;
  return (
    ((t = (e = globalThis.crypto) == null ? void 0 : e.randomUUID) == null ? void 0 : t.call(e)) ??
    `k-${Date.now()}-${Math.random()}`
  );
}
function Vv(e = '') {
  const t = (d) => `${e}/storefront/v1${d}`,
    n = (d) => `${e}/checkout/v1${d}`;
  let r = $v(),
    l = null;
  const a = new Map();
  let o = Promise.resolve();
  const s = () => (r ? { authorization: `Bearer ${r}` } : {}),
    u = () => ge(n('/cart'), { headers: s() }),
    c = () => {
      var d;
      r = null;
      try {
        (d = globalThis.sessionStorage) == null || d.removeItem(Bs);
      } catch {}
    },
    m = async () => (
      l ??
        (l = (async () => {
          if (r)
            try {
              const { cart: f } = await u();
              if (f.status === 'open') return { cart: f };
            } catch (f) {
              if (!(f instanceof Zr) || f.status !== 401) throw f;
            }
          const d = await ge(n('/session'), {
            method: 'POST',
            headers: { ...s(), 'idempotency-key': Tt() },
          });
          return ((r = d.sessionToken), Uv(r), { cart: d.cart });
        })().finally(() => {
          l = null;
        })),
      l
    );
  return {
    get sessionToken() {
      return r;
    },
    store: () => ge(t('/store')),
    catalog: () => ge(t('/catalog')),
    product: (d) => ge(t(`/products/${d}`)),
    surfaces: (d) => ge(t(`/surfaces${d === void 0 ? '' : `?zoneMatched=${d}`}`)),
    zones: () => ge(t('/zones')),
    state: (d = !1) => ge(t(`/state${d ? '?templates=1' : ''}`)),
    notifyMe: (d) =>
      ge(n('/notify-me'), {
        method: 'POST',
        headers: { 'idempotency-key': Tt() },
        body: JSON.stringify(d),
      }),
    orderIds: () => [...new Set([...a.keys(), ...Object.keys(bi())])].reverse(),
    quote: (d) =>
      ge(n('/quote'), {
        method: 'POST',
        headers: { 'idempotency-key': Tt() },
        body: JSON.stringify({ neighborhood: d }),
      }),
    clearSession: c,
    ensureSession: m,
    cart: u,
    async addItem(d, f = 1, v = []) {
      return (
        await m(),
        (
          await ge(n('/cart/items'), {
            method: 'POST',
            headers: { ...s(), 'idempotency-key': Tt() },
            body: JSON.stringify({ productId: d, qty: f, modifierIds: v }),
          })
        ).cart
      );
    },
    updateItem: (d, f) =>
      ge(n(`/cart/items/${d}`), {
        method: 'PATCH',
        headers: { ...s(), 'idempotency-key': Tt() },
        body: JSON.stringify({ qty: f }),
      }).then((v) => v.cart),
    removeItem: (d) =>
      ge(n(`/cart/items/${d}`), {
        method: 'DELETE',
        headers: { ...s(), 'idempotency-key': Tt() },
      }).then((f) => f.cart),
    setDelivery: (d) => {
      const f = r,
        v = f ? { authorization: `Bearer ${f}` } : {},
        k = o.then(() =>
          ge(n('/cart/delivery'), {
            method: 'POST',
            headers: { ...v, 'idempotency-key': Tt() },
            body: JSON.stringify(d),
          }).then((w) => w.cart),
        );
      return ((o = k.catch(() => {})), k);
    },
    async checkout(d) {
      const f = await ge(n('/checkout'), {
        method: 'POST',
        headers: { ...s(), 'idempotency-key': Tt() },
        body: JSON.stringify(d),
      });
      r && (a.set(f.order.id, r), Fv(f.order.id, r));
      try {
        (c(), await m());
      } catch {}
      return f.order;
    },
    order: (d) => {
      const f = a.get(d) ?? bi()[d] ?? r;
      return ge(n(`/orders/${d}`), { headers: f ? { authorization: `Bearer ${f}` } : {} }).then(
        (v) => v.order,
      );
    },
  };
}
const Hv = {
    SOLD_OUT: { title: 'Esgotou agora há pouco', body: 'Esse item acabou. Escolha outro sabor.' },
    MODIFIER_SOLD_OUT: { title: 'Essa opção esgotou', body: 'Escolha outra opção para continuar.' },
    MODIFIER_REQUIRED: {
      title: 'Falta escolher uma opção',
      body: 'Complete as escolhas obrigatórias.',
    },
    MODIFIER_LIMIT: { title: 'Opções demais', body: 'Reduza as escolhas desse grupo.' },
    STORE_PAUSED: { title: 'A loja pausou os pedidos', body: 'Volte em instantes.' },
    STORE_CLOSED: { title: 'A loja está fechada agora' },
    OUT_OF_ZONE: { title: 'Fora da área de entrega', body: 'Retirada continua disponível.' },
    ORDER_MIN_NOT_MET: {
      title: 'Pedido abaixo do mínimo',
      body: 'Adicione mais itens para continuar.',
    },
    DELIVERY_UNAVAILABLE: { title: 'Entrega indisponível agora', body: 'Escolha retirada.' },
    PICKUP_UNAVAILABLE: { title: 'Retirada indisponível agora', body: 'Escolha entrega.' },
    EMPTY_CART: { title: 'Sua sacola está vazia' },
    CART_NOT_OPEN: { title: 'Essa sacola já virou pedido', body: 'Recarregue para começar outra.' },
    PRODUCT_NOT_FOUND: { title: 'Produto indisponível' },
    NETWORK_ERROR: {
      title: 'Sem conexão com a loja',
      body: 'Confira sua internet e tente de novo.',
    },
    RATE_LIMITED: { title: 'Muitas tentativas seguidas', body: 'Espere alguns segundos.' },
  },
  Wv = { title: 'Não foi possível concluir', body: 'Tente novamente em instantes.' };
function Mi(e) {
  return Hv[e] ?? Wv;
}
function ip(e) {
  return e instanceof Zr || (e && typeof e == 'object' && typeof e.code == 'string')
    ? e.code
    : 'INTERNAL';
}
let un = [];
const Oi = new Set(),
  sp = () => Oi.forEach((e) => e()),
  Qv = new Set(['STORE_PAUSED', 'STORE_CLOSED', 'TENANT_SUSPENDED']);
let Yl = null;
function jc(e) {
  Yl = e;
}
function Ha(e) {
  const t = ip(e),
    n = Mi(t),
    r = `error:${t}`;
  ((un = [
    ...un.filter((l) => l.id !== r),
    {
      id: r,
      kind: 'error',
      severity: 'warning',
      title: n.title,
      ...(n.body ? { body: n.body } : {}),
      dismissible: !0,
      priority: 90,
      payload: { code: t },
    },
  ].slice(-3)),
    sp(),
    setTimeout(() => up(r), 8e3),
    Qv.has(t) && (Yl == null || Yl()));
}
function up(e) {
  const t = un.filter((n) => n.id !== e);
  t.length !== un.length && ((un = t), sp());
}
function Kv() {
  return x.useSyncExternalStore(
    (e) => (Oi.add(e), () => Oi.delete(e)),
    () => un,
    () => un,
  );
}
const Sc = 'vendua.sid',
  cp = 'vendua.consent',
  qv = 20,
  Yv = 4e3;
function Ii() {
  var e, t;
  return (
    ((t = (e = globalThis.crypto) == null ? void 0 : e.randomUUID) == null ? void 0 : t.call(e)) ??
    `${Date.now()}-${Math.random()}`
  ).replace(/[^A-Za-z0-9_-]/g, '');
}
function Jv() {
  var e, t;
  try {
    let n = (e = globalThis.sessionStorage) == null ? void 0 : e.getItem(Sc);
    return (
      n || ((n = Ii().slice(0, 32)), (t = globalThis.sessionStorage) == null || t.setItem(Sc, n)),
      n
    );
  } catch {
    return Gv ?? (Gv = Ii().slice(0, 32));
  }
}
let Gv;
function Xv() {
  var e;
  try {
    const t = (e = globalThis.localStorage) == null ? void 0 : e.getItem(cp),
      n = t ? JSON.parse(t) : null;
    return (n == null ? void 0 : n.version) === 1 && Array.isArray(n.purposes) ? n : null;
  } catch {
    return null;
  }
}
function Zv(e) {
  var n;
  const t = { version: 1, purposes: e, at: new Date().toISOString() };
  try {
    (n = globalThis.localStorage) == null || n.setItem(cp, JSON.stringify(t));
  } catch {}
  return ((dp = t), Ai.forEach((r) => r()), t);
}
let dp = null;
const Ai = new Set();
function ey(e) {
  return (Ai.add(e), () => Ai.delete(e));
}
function ty() {
  return dp ?? Xv();
}
class ny {
  constructor() {
    kn(this, 'queue', []);
    kn(this, 'timer', null);
    kn(this, 'baseUrl', '');
    kn(this, 'wired', !1);
  }
  configure(t) {
    ((this.baseUrl = t),
      !(this.wired || typeof window > 'u') &&
        ((this.wired = !0),
        window.addEventListener('pagehide', () => this.flush(!0)),
        document.addEventListener('visibilitychange', () => {
          document.visibilityState === 'hidden' && this.flush(!0);
        })));
  }
  push(t, n) {
    this.queue.push({ name: t, at: Date.now(), props: n });
    const r = globalThis;
    ((r.__VENDUA_EVENTS__ ?? (r.__VENDUA_EVENTS__ = [])).push({
      name: t,
      at: Date.now(),
      props: n,
    }),
      r.__VENDUA_EVENTS__.length > 200 && r.__VENDUA_EVENTS__.splice(0, 100),
      this.queue.length >= qv
        ? this.flush()
        : (this.timer ?? (this.timer = setTimeout(() => this.flush(), Yv))));
  }
  flush(t = !1) {
    if ((this.timer && clearTimeout(this.timer), (this.timer = null), this.queue.length === 0))
      return;
    const n = this.queue.splice(0, 50),
      r = JSON.stringify({ batchId: Ii().slice(0, 32), sessionId: Jv(), events: n }),
      l = `${this.baseUrl}/storefront/v1/events`;
    try {
      if (t && typeof navigator < 'u' && navigator.sendBeacon) {
        navigator.sendBeacon(l, new Blob([r], { type: 'application/json' }));
        return;
      }
      fetch(l, {
        method: 'POST',
        body: r,
        keepalive: !0,
        headers: { 'content-type': 'application/json' },
      }).catch(() => {});
    } catch {}
  }
}
const fp = new ny();
function Qe(e, t = {}) {
  fp.push(e, t);
}
function Wa(e) {
  const t = { ...e, at: Date.now() },
    n = globalThis;
  ((n.__VENDUA_REPORTS__ ?? (n.__VENDUA_REPORTS__ = [])).push(t),
    n.__VENDUA_REPORTS__.length > 100 && n.__VENDUA_REPORTS__.splice(0, 50),
    Qe(e.kind === 'slot_error' || e.kind === 'section_error' ? 'slot_error' : 'section_unknown', {
      kind: e.kind,
      target: e.target,
      message: e.message.slice(0, 200),
    }),
    console.warn(`[vendua] ${e.kind}: ${e.target} — ${e.message}`));
}
const pp = x.createContext(null);
function J() {
  const e = x.useContext(pp);
  if (!e) throw new Error('useKernel must be used inside <VenduaProvider>');
  return e;
}
function ry(e) {
  const t = {
    '--v-color-bg': e.color.bg,
    '--v-color-surface': e.color.surface,
    '--v-color-text': e.color.text,
    '--v-color-muted': e.color.muted,
    '--v-color-accent': e.color.accent,
    '--v-color-on-accent': e.color.onAccent,
    '--v-color-danger': e.color.danger,
    '--v-color-success': e.color.success,
    '--v-font-display': e.font.display,
    '--v-font-body': e.font.body,
    '--v-radius-sm': e.radius.sm,
    '--v-radius-md': e.radius.md,
    '--v-radius-lg': e.radius.lg,
    '--v-motion-duration': e.motion.duration,
    '--v-motion-easing': e.motion.easing,
  };
  return (
    e.font.mono && (t['--v-font-mono'] = e.font.mono),
    Array.isArray(e.space.scale)
      ? e.space.scale.forEach((n, r) => {
          t[`--v-space-${r}`] = n;
        })
      : (t['--v-space-scale'] = String(e.space.scale)),
    t
  );
}
const ly = { sections: {}, snapshot: { templates: {}, tokens: null } };
function ay({ config: e, storefront: t = ly, baseUrl: n = '', children: r }) {
  var c;
  const l = t.snapshot.tokens ?? e.tokens,
    a = x.useRef();
  (!a.current || a.current.baseUrl !== n) &&
    ((c = a.current) == null || c.api.clearSession(), (a.current = { api: Vv(n), baseUrl: n }));
  const o = a.current.api,
    s = x.useRef(new Map()),
    u = x.useMemo(
      () => ({
        api: o,
        config: e,
        tokens: l,
        storefront: t,
        invalidate(m) {
          var d;
          (d = s.current.get(m)) == null || d.forEach((f) => f());
        },
        subscribe(m, d) {
          let f = s.current.get(m);
          return (f || s.current.set(m, (f = new Set())), f.add(d), () => f.delete(d));
        },
      }),
      [e, o, l, t],
    );
  return (
    x.useEffect(
      () => (
        fp.configure(n),
        jc(() => {
          for (const m of ['store', 'surfaces:any', 'surfaces:true', 'surfaces:false']) $s(m);
        }),
        () => jc(null)
      ),
      [n],
    ),
    x.useEffect(() => {
      const m = document.documentElement,
        d = ry(l);
      for (const [f, v] of Object.entries(d)) m.style.setProperty(f, v);
      return () => {
        for (const f of Object.keys(d)) m.style.removeProperty(f);
      };
    }, [l]),
    x.useEffect(() => {
      const m = l.font.srcs;
      if (!(m != null && m.length)) return;
      const d = document.createElement('style');
      return (
        (d.dataset.vendua = 'fonts'),
        (d.textContent = m
          .map(
            (f) =>
              `@font-face{font-family:${JSON.stringify(f.family)};src:url(${JSON.stringify(f.src)});font-display:swap;` +
              (f.weight != null ? `font-weight:${f.weight};` : '') +
              (f.style ? `font-style:${f.style};` : '') +
              '}',
          )
          .join('')),
        document.head.appendChild(d),
        () => {
          d.remove();
        }
      );
    }, [l]),
    x.useEffect(() => {
      const m = { cache: Fs(o), invalidate: u.invalidate };
      return (
        Di.add(m),
        () => {
          Di.delete(m);
        }
      );
    }, [o, u.invalidate]),
    x.useEffect(() => {
      globalThis.__VENDUA_KERNEL_MOUNTED__ = !0;
      const m = document.getElementById('vendua-loader-overlay');
      (m == null ? void 0 : m.dataset.mode) !== 'maintenance' && (m == null || m.remove());
    }, []),
    i.jsx(pp.Provider, { value: u, children: r })
  );
}
const Nc = new WeakMap();
function Fs(e) {
  let t = Nc.get(e);
  return (t || Nc.set(e, (t = new Map())), t);
}
function _t(e, t) {
  const { api: n, subscribe: r, invalidate: l } = J(),
    [, a] = x.useState(0),
    o = Fs(n),
    s = o.get(e) ?? {};
  return (
    x.useEffect(() => {
      var d;
      let u = !0;
      const c = () => {
        const f = o.get(e) ?? {};
        if (f.inflight) {
          f.inflight.finally(() => {
            u && a((k) => k + 1);
          });
          return;
        }
        const v = Symbol(e);
        ((f.runToken = v),
          (f.inflight = t()
            .then((k) => {
              const w = o.get(e);
              (w == null ? void 0 : w.runToken) === v && o.set(e, { resolved: !0, data: k });
            })
            .catch((k) => {
              const w = o.get(e);
              (w == null ? void 0 : w.runToken) === v && o.set(e, { resolved: !0, error: k });
            })
            .finally(() => {
              u && a((k) => k + 1);
            })),
          o.set(e, f));
      };
      (!s.inflight && (!s.resolved || s.error) && c(),
        (d = s.inflight) == null ||
          d.finally(() => {
            u && a((f) => f + 1);
          }));
      const m = r(e, c);
      return () => {
        ((u = !1), m());
      };
    }, [e, n]),
    {
      data: s.data,
      error: s.error,
      loading: !s.resolved && !s.error,
      refetch: () => {
        (o.delete(e), l(e));
      },
    }
  );
}
const Di = new Set();
function oy(e, t, n) {
  const r = Fs(e),
    l = r.get(t);
  if ((l != null && l.resolved) || (l != null && l.inflight)) return;
  const a = Symbol(t),
    o = { runToken: a };
  ((o.inflight = n()
    .then((s) => {
      var u;
      ((u = r.get(t)) == null ? void 0 : u.runToken) === a && r.set(t, { resolved: !0, data: s });
    })
    .catch((s) => {
      var u;
      ((u = r.get(t)) == null ? void 0 : u.runToken) === a && r.set(t, { resolved: !0, error: s });
    })),
    r.set(t, o));
}
function $s(e, t) {
  for (const n of Di)
    (t !== void 0 ? n.cache.set(e, { resolved: !0, data: t }) : n.cache.delete(e), n.invalidate(e));
}
function se(e, t = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: t }).format(e / 100);
}
function Us(e, t) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(e));
}
const Qa = {
    placed: 'Pedido recebido',
    confirmed: 'Pedido confirmado',
    preparing: 'Em preparo',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
    refunded: 'Reembolsado',
  },
  hp = { pix: 'Pix', card_on_delivery: 'Cartão na entrega', cash: 'Dinheiro' };
function iy({ steps: e, current: t, onStep: n, children: r }) {
  return i.jsxs('div', {
    className: 'v-checkout',
    'data-part': 'root',
    children: [
      i.jsx('ol', {
        className: 'v-steps',
        'data-part': 'steps',
        'aria-label': 'Etapas do pedido',
        children: e.map((l, a) =>
          i.jsx(
            'li',
            {
              className: 'v-step',
              'data-part': 'step',
              'data-state': l.id === t ? 'current' : l.done ? 'done' : 'todo',
              'aria-current': l.id === t ? 'step' : void 0,
              children:
                l.done && l.id !== t
                  ? i.jsxs('button', {
                      type: 'button',
                      className: 'v-step-btn',
                      onClick: () => n(l.id),
                      children: [
                        i.jsx('span', { className: 'v-step-n', children: a + 1 }),
                        ' ',
                        l.label,
                      ],
                    })
                  : i.jsxs('span', {
                      className: 'v-step-btn',
                      children: [
                        i.jsx('span', { className: 'v-step-n', children: a + 1 }),
                        ' ',
                        l.label,
                      ],
                    }),
            },
            l.id,
          ),
        ),
      }),
      i.jsx('div', { className: 'v-checkout-body', 'data-part': 'body', children: r }),
    ],
  });
}
function sy({ cart: e, currency: t }) {
  var r;
  const n = e.totals;
  return i.jsxs('section', {
    className: 'v-summary',
    'data-vendua': 'checkout-summary',
    'data-part': 'root',
    'aria-label': 'Resumo do pedido',
    children: [
      i.jsx('ul', {
        className: 'v-summary-lines',
        'data-part': 'lines',
        children: e.items.map((l) =>
          i.jsxs(
            'li',
            {
              className: 'v-summary-line',
              children: [
                i.jsxs('span', { children: [l.qty, '× ', l.name] }),
                i.jsx('span', { className: 'v-num', children: se(l.lineTotalCents, t) }),
              ],
            },
            l.id,
          ),
        ),
      }),
      i.jsxs('dl', {
        className: 'v-summary-totals',
        'data-part': 'totals',
        children: [
          i.jsxs('div', {
            children: [
              i.jsx('dt', { children: 'Subtotal' }),
              i.jsx('dd', {
                className: 'v-num',
                'data-vendua': 'subtotal',
                children: se(n.subtotalCents, t),
              }),
            ],
          }),
          ((r = e.delivery) == null ? void 0 : r.mode) === 'delivery'
            ? i.jsxs('div', {
                children: [
                  i.jsxs('dt', {
                    children: [
                      'Entrega',
                      e.delivery.neighborhood ? ` · ${e.delivery.neighborhood}` : '',
                    ],
                  }),
                  i.jsx('dd', {
                    className: 'v-num',
                    'data-vendua': 'delivery-fee',
                    children: n.deliveryFeeCents > 0 ? se(n.deliveryFeeCents, t) : 'grátis',
                  }),
                ],
              })
            : null,
          i.jsxs('div', {
            className: 'v-summary-total',
            children: [
              i.jsx('dt', { children: 'Total' }),
              i.jsx('dd', {
                className: 'v-num',
                'data-vendua': 'total',
                children: se(n.totalCents, t),
              }),
            ],
          }),
        ],
      }),
      n.belowMinOrder
        ? i.jsxs('p', {
            className: 'v-alert',
            role: 'status',
            'data-part': 'min-order',
            children: [
              'Faltam ',
              se(n.remainingMinOrderCents, t),
              ' para o pedido mínimo de',
              ' ',
              se(n.minOrderCents, t),
              '.',
            ],
          })
        : null,
    ],
  });
}
function Sn({ id: e, label: t, error: n, children: r }) {
  return i.jsxs('div', {
    className: 'v-field',
    'data-part': 'field',
    'data-invalid': n ? !0 : void 0,
    children: [
      i.jsx('label', { className: 'v-label', htmlFor: e, children: t }),
      r,
      n
        ? i.jsx('p', { className: 'v-field-error', id: `${e}-error`, role: 'alert', children: n })
        : null,
    ],
  });
}
function uy({ value: e, onChange: t, errors: n, part: r, neighborhoods: l }) {
  const a = (s) => n[s],
    o = (s) => (n[s] ? { 'aria-invalid': !0, 'aria-describedby': `checkout-${s}-error` } : {});
  return r === 'customer'
    ? i.jsxs('fieldset', {
        className: 'v-fieldset',
        'data-part': 'root',
        children: [
          i.jsx('legend', { className: 'v-legend', children: 'Seus dados' }),
          i.jsx(Sn, {
            id: 'checkout-name',
            label: 'Nome',
            error: a('name'),
            children: i.jsx('input', {
              id: 'checkout-name',
              name: 'name',
              className: 'v-input',
              autoComplete: 'name',
              maxLength: 120,
              value: e.name,
              onChange: (s) => t({ name: s.target.value }),
              ...o('name'),
            }),
          }),
          i.jsx(Sn, {
            id: 'checkout-phone',
            label: 'WhatsApp',
            error: a('phone'),
            children: i.jsx('input', {
              id: 'checkout-phone',
              name: 'phone',
              type: 'tel',
              inputMode: 'tel',
              className: 'v-input',
              autoComplete: 'tel',
              maxLength: 20,
              placeholder: '(00) 00000-0000',
              value: e.phone,
              onChange: (s) => t({ phone: s.target.value }),
              ...o('phone'),
            }),
          }),
          i.jsxs('label', {
            className: 'v-check',
            'data-part': 'remember',
            children: [
              i.jsx('input', {
                type: 'checkbox',
                checked: e.remember,
                onChange: (s) => t({ remember: s.target.checked }),
              }),
              ' ',
              'Lembrar meus dados neste aparelho',
            ],
          }),
        ],
      })
    : i.jsxs('fieldset', {
        className: 'v-fieldset',
        'data-part': 'root',
        children: [
          i.jsx('legend', { className: 'v-legend', children: 'Endereço de entrega' }),
          i.jsxs(Sn, {
            id: 'checkout-neighborhood',
            label: 'Bairro',
            error: a('neighborhood'),
            children: [
              i.jsx('input', {
                id: 'checkout-neighborhood',
                name: 'neighborhood',
                className: 'v-input',
                list: 'checkout-neighborhoods',
                maxLength: 80,
                value: e.neighborhood,
                onChange: (s) => t({ neighborhood: s.target.value }),
                ...o('neighborhood'),
              }),
              i.jsx('datalist', {
                id: 'checkout-neighborhoods',
                children: l.map((s) => i.jsx('option', { value: s }, s)),
              }),
            ],
          }),
          i.jsxs('div', {
            className: 'v-field-row',
            children: [
              i.jsx(Sn, {
                id: 'checkout-street',
                label: 'Rua',
                error: a('street'),
                children: i.jsx('input', {
                  id: 'checkout-street',
                  name: 'street',
                  className: 'v-input',
                  autoComplete: 'address-line1',
                  maxLength: 120,
                  value: e.street,
                  onChange: (s) => t({ street: s.target.value }),
                  ...o('street'),
                }),
              }),
              i.jsx(Sn, {
                id: 'checkout-number',
                label: 'Número',
                error: a('number'),
                children: i.jsx('input', {
                  id: 'checkout-number',
                  name: 'number',
                  className: 'v-input v-input-short',
                  inputMode: 'numeric',
                  maxLength: 10,
                  value: e.number,
                  onChange: (s) => t({ number: s.target.value }),
                  ...o('number'),
                }),
              }),
            ],
          }),
          i.jsx(Sn, {
            id: 'checkout-complement',
            label: 'Complemento (opcional)',
            error: a('complement'),
            children: i.jsx('input', {
              id: 'checkout-complement',
              name: 'complement',
              className: 'v-input',
              autoComplete: 'address-line2',
              maxLength: 80,
              value: e.complement,
              onChange: (s) => t({ complement: s.target.value }),
            }),
          }),
        ],
      });
}
function cy({ options: e, selected: t, onSelect: n }) {
  return i.jsxs('fieldset', {
    className: 'v-fieldset',
    'data-part': 'root',
    children: [
      i.jsx('legend', { className: 'v-legend', children: 'Como você quer receber?' }),
      i.jsx('div', {
        className: 'v-options',
        role: 'radiogroup',
        'aria-label': 'Entrega ou retirada',
        children: e.map((r) =>
          i.jsxs(
            'label',
            {
              className: 'v-option',
              'data-part': 'option',
              'data-selected': r.mode === t || void 0,
              children: [
                i.jsx('input', {
                  type: 'radio',
                  name: 'delivery-mode',
                  value: r.mode,
                  checked: r.mode === t,
                  disabled: r.disabled,
                  onChange: () => n(r.mode),
                }),
                i.jsx('span', { className: 'v-option-label', children: r.label }),
                r.detail
                  ? i.jsx('span', { className: 'v-option-detail v-muted', children: r.detail })
                  : null,
              ],
            },
            r.mode,
          ),
        ),
      }),
    ],
  });
}
function dy({ methods: e, selected: t, onSelect: n }) {
  return i.jsxs('fieldset', {
    className: 'v-fieldset',
    'data-part': 'root',
    children: [
      i.jsx('legend', { className: 'v-legend', children: 'Pagamento' }),
      i.jsx('div', {
        className: 'v-options',
        role: 'radiogroup',
        'aria-label': 'Forma de pagamento',
        children: e.map((r) =>
          i.jsxs(
            'label',
            {
              className: 'v-option',
              'data-part': 'option',
              'data-selected': r.id === t || void 0,
              children: [
                i.jsx('input', {
                  type: 'radio',
                  name: 'payment-method',
                  value: r.id,
                  checked: r.id === t,
                  onChange: () => n(r.id),
                }),
                i.jsx('span', { className: 'v-option-label', children: r.label }),
                r.detail
                  ? i.jsx('span', { className: 'v-option-detail v-muted', children: r.detail })
                  : null,
              ],
            },
            r.id,
          ),
        ),
      }),
    ],
  });
}
function fy({ order: e, currency: t }) {
  return i.jsxs('section', {
    className: 'v-panel v-success',
    'data-vendua': 'checkout-success',
    'data-part': 'root',
    role: 'status',
    children: [
      i.jsxs('h1', {
        className: 'v-page-title',
        'data-part': 'title',
        children: ['Pedido #', e.number, ' recebido!'],
      }),
      i.jsxs('p', {
        className: 'v-muted',
        'data-part': 'body',
        children: [
          Qa[e.state] ?? e.state,
          ' · ',
          se(e.totalCents, t),
          ' ·',
          ' ',
          hp[e.payment.method] ?? e.payment.method,
        ],
      }),
      e.payment.instructions
        ? i.jsx('p', {
            className: 'v-note',
            'data-part': 'instructions',
            children: e.payment.instructions,
          })
        : null,
    ],
  });
}
function py({ onBrowse: e }) {
  return i.jsxs('div', {
    className: 'v-panel v-empty',
    'data-vendua': 'empty-cart',
    'data-part': 'root',
    children: [
      i.jsx('p', {
        className: 'v-panel-title',
        'data-part': 'title',
        children: 'Sua sacola está vazia.',
      }),
      i.jsx('button', {
        type: 'button',
        className: 'v-btn v-btn-accent',
        'data-part': 'browse',
        onClick: e,
        children: 'Ver cardápio',
      }),
    ],
  });
}
function hy({ qty: e, min: t = 0, max: n = 99, pending: r, onChange: l, label: a = 'quantidade' }) {
  return i.jsxs('span', {
    className: 'v-qty',
    'data-vendua': 'qty-stepper',
    'data-part': 'qty',
    role: 'group',
    'aria-label': a,
    'data-pending': r || void 0,
    children: [
      i.jsx('button', {
        type: 'button',
        'aria-label': 'diminuir',
        disabled: r || e <= t,
        onClick: () => l(e - 1),
        children: '−',
      }),
      i.jsx('output', { 'aria-live': 'polite', children: e }),
      i.jsx('button', {
        type: 'button',
        'aria-label': 'aumentar',
        disabled: r || e >= n,
        onClick: () => l(e + 1),
        children: '+',
      }),
    ],
  });
}
function my({ cart: e, presentation: t, checkout: n, lines: r, summary: l, onClose: a }) {
  return i.jsxs('section', {
    className: 'v-cart',
    'data-part': 'root',
    'data-presentation': t,
    'aria-label': 'Sacola',
    children: [
      i.jsxs('header', {
        className: 'v-cart-head',
        'data-part': 'head',
        children: [
          i.jsx('h1', { className: 'v-page-title', children: 'Sacola' }),
          i.jsxs('p', {
            className: 'v-muted',
            children: [e.totals.itemCount, ' ', e.totals.itemCount === 1 ? 'item' : 'itens'],
          }),
          t === 'drawer'
            ? i.jsx('button', {
                type: 'button',
                className: 'v-btn v-btn-ghost',
                onClick: a,
                'aria-label': 'Fechar sacola',
                children: '×',
              })
            : null,
        ],
      }),
      i.jsxs('div', {
        className: 'v-cart-grid',
        children: [
          i.jsx('ol', { className: 'v-cart-lines', 'data-part': 'lines', children: r }),
          i.jsxs('aside', {
            className: 'v-cart-aside',
            'data-part': 'aside',
            children: [
              l,
              n,
              i.jsx('button', {
                type: 'button',
                className: 'v-btn v-btn-ghost v-btn-block',
                'data-part': 'continue',
                onClick: a,
                children: 'Continuar escolhendo',
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function gy({ item: e, currency: t, pending: n, onQty: r, onRemove: l }) {
  const a = e.productStatus !== 'active';
  return i.jsxs('li', {
    className: 'v-line',
    'data-vendua': 'cart-line',
    'data-part': 'root',
    'data-unavailable': a || void 0,
    children: [
      i.jsxs('div', {
        className: 'v-line-main',
        children: [
          i.jsx('p', { className: 'v-line-name', 'data-part': 'name', children: e.name }),
          e.modifiers.length > 0
            ? i.jsx('p', {
                className: 'v-muted v-line-mods',
                'data-part': 'modifiers',
                children: e.modifiers
                  .map((o) =>
                    o.priceDeltaCents > 0 ? `${o.name} (+${se(o.priceDeltaCents, t)})` : o.name,
                  )
                  .join(', '),
              })
            : null,
          a
            ? i.jsx('p', {
                className: 'v-alert',
                role: 'status',
                children: 'Indisponível agora — remova para continuar.',
              })
            : null,
          i.jsxs('div', {
            className: 'v-line-actions',
            'data-part': 'actions',
            children: [
              i.jsx(hy, { qty: e.qty, pending: n, onChange: r, label: `quantidade de ${e.name}` }),
              i.jsx('button', {
                type: 'button',
                className: 'v-link-btn',
                'data-part': 'remove',
                'aria-label': `Remover ${e.name}`,
                disabled: n,
                onClick: l,
                children: 'Remover',
              }),
            ],
          }),
        ],
      }),
      i.jsx('p', {
        className: 'v-line-total v-num',
        'data-part': 'total',
        children: se(e.lineTotalCents, t),
      }),
    ],
  });
}
function vy({ events: e }) {
  return i.jsx('ol', {
    className: 'v-timeline',
    'data-vendua': 'order-timeline',
    'data-part': 'root',
    children: e.map((t, n) =>
      i.jsxs(
        'li',
        {
          className: 'v-timeline-item',
          'data-part': 'event',
          'data-state': t.to,
          children: [
            i.jsx('span', { className: 'v-timeline-label', children: Qa[t.to] ?? t.to }),
            i.jsx('time', { className: 'v-muted', dateTime: t.at, children: Us(t.at) }),
          ],
        },
        `${t.at}-${n}`,
      ),
    ),
  });
}
function yy({ order: e, currency: t, timeline: n }) {
  const r = e.delivery;
  return i.jsxs('section', {
    className: 'v-order',
    'data-vendua': 'order-status',
    'data-part': 'root',
    'data-state': e.state,
    children: [
      i.jsxs('header', {
        className: 'v-order-head',
        'data-part': 'head',
        children: [
          i.jsxs('p', { className: 'v-eyebrow', children: ['Pedido #', e.number] }),
          i.jsx('h1', {
            className: 'v-page-title',
            'data-part': 'state',
            children: Qa[e.state] ?? e.state,
          }),
          r.etaMin != null && r.etaMax != null && r.mode === 'delivery'
            ? i.jsxs('p', {
                className: 'v-muted',
                children: ['Entrega em ', r.etaMin, '–', r.etaMax, ' min'],
              })
            : null,
        ],
      }),
      i.jsxs('div', {
        className: 'v-order-grid',
        children: [
          i.jsx('div', { 'data-part': 'timeline', children: n }),
          i.jsxs('dl', {
            className: 'v-order-facts',
            'data-part': 'facts',
            children: [
              i.jsxs('div', {
                children: [
                  i.jsx('dt', { children: r.mode === 'delivery' ? 'Entrega' : 'Retirada' }),
                  i.jsx('dd', {
                    children:
                      r.mode === 'delivery' ? (r.neighborhood ?? 'Endereço informado') : 'Na loja',
                  }),
                ],
              }),
              i.jsxs('div', {
                children: [
                  i.jsx('dt', { children: 'Pagamento' }),
                  i.jsx('dd', { children: hp[e.payment.method] ?? e.payment.method }),
                ],
              }),
              i.jsxs('div', {
                children: [
                  i.jsx('dt', { children: 'Total' }),
                  i.jsx('dd', { className: 'v-num', children: se(e.totalCents, t) }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
const xy = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
function wy({ hours: e }) {
  const t = xy.map((n, r) => ({
    label: n,
    windows: e.windows.filter((l) => l.days.includes(r)).map((l) => `${l.open}–${l.close}`),
  }));
  return i.jsxs('table', {
    className: 'v-hours',
    'data-vendua': 'hours-table',
    'data-part': 'root',
    children: [
      i.jsx('caption', { className: 'v-sr', children: 'Horário de funcionamento' }),
      i.jsx('tbody', {
        children: t.map((n) =>
          i.jsxs(
            'tr',
            {
              'data-part': 'row',
              children: [
                i.jsx('th', { scope: 'row', children: n.label }),
                i.jsx('td', {
                  className: 'v-num',
                  children: n.windows.length ? n.windows.join(', ') : 'Fechado',
                }),
              ],
            },
            n.label,
          ),
        ),
      }),
    ],
  });
}
function ky({ product: e, currency: t, link: n }) {
  const r = e.status !== 'active',
    [l, a] = x.useState(!1);
  return i.jsx('article', {
    className: 'v-card',
    'data-part': 'root',
    'data-status': e.status,
    children: n(
      i.jsxs(i.Fragment, {
        children: [
          i.jsx('div', {
            className: 'v-card-media',
            'data-part': 'media',
            'aria-hidden': 'true',
            children:
              e.imageUrl && !l
                ? i.jsx('img', {
                    src: e.imageUrl,
                    alt: '',
                    loading: 'lazy',
                    decoding: 'async',
                    onError: () => a(!0),
                  })
                : i.jsx('span', {
                    className: 'v-card-initial',
                    'data-figure': e.figureVariant,
                    children: e.name.slice(0, 1).toUpperCase(),
                  }),
          }),
          i.jsx('h3', { className: 'v-card-name', 'data-part': 'name', children: e.name }),
          e.description
            ? i.jsx('p', {
                className: 'v-card-desc v-muted',
                'data-part': 'description',
                children: e.description,
              })
            : null,
          i.jsx('p', {
            className: 'v-card-price v-num',
            'data-part': 'price',
            children: r
              ? i.jsx('span', { className: 'v-flag', children: 'Esgotado' })
              : se(e.basePriceCents, t),
          }),
        ],
      }),
    ),
  });
}
function jy({ groups: e, value: t, onChange: n, currency: r, errors: l }) {
  return i.jsx('div', {
    className: 'v-mods',
    'data-vendua': 'modifier-picker',
    'data-part': 'root',
    children: e.map((a) => {
      const o = a.maxSelect === 1,
        s = t[a.id] ?? [],
        u = a.required
          ? o
            ? 'obrigatório'
            : `escolha ${Math.max(1, a.minSelect)}–${a.maxSelect}`
          : o
            ? 'opcional'
            : `até ${a.maxSelect}`;
      return i.jsxs(
        'fieldset',
        {
          className: 'v-mod-group',
          'data-part': 'group',
          'data-invalid': l[a.id] ? !0 : void 0,
          children: [
            i.jsxs('legend', {
              className: 'v-legend',
              children: [
                a.name,
                ' ',
                i.jsxs('span', { className: 'v-muted', children: ['— ', u] }),
              ],
            }),
            i.jsx('ul', {
              className: 'v-mod-list',
              role: o ? 'radiogroup' : 'group',
              'aria-label': a.name,
              children: a.modifiers.map((c) => {
                const m = s.includes(c.id),
                  d = c.status !== 'active',
                  f = !m && !o && s.length >= a.maxSelect;
                return i.jsx(
                  'li',
                  {
                    children: i.jsxs('button', {
                      type: 'button',
                      role: o ? 'radio' : 'checkbox',
                      'aria-checked': m,
                      disabled: d || f,
                      className: 'v-mod',
                      'data-part': 'modifier',
                      'data-selected': m || void 0,
                      onClick: () =>
                        n(a.id, m ? s.filter((v) => v !== c.id) : o ? [c.id] : [...s, c.id]),
                      children: [
                        i.jsx('span', { children: c.name }),
                        d ? i.jsx('span', { className: 'v-muted', children: ' · esgotado' }) : null,
                        c.priceDeltaCents !== 0
                          ? i.jsxs('span', {
                              className: 'v-muted v-num',
                              children: [
                                ' ',
                                c.priceDeltaCents > 0 ? '+' : '−',
                                se(Math.abs(c.priceDeltaCents), r),
                              ],
                            })
                          : null,
                      ],
                    }),
                  },
                  c.id,
                );
              }),
            }),
            l[a.id]
              ? i.jsx('p', { className: 'v-field-error', role: 'alert', children: l[a.id] })
              : null,
          ],
        },
        a.id,
      );
    }),
  });
}
const Sy = new Set(['info', 'warning', 'blocking']);
function el(e) {
  if (e.kind === 'emergency') return 'blocking';
  const t = String(e.severity);
  return Sy.has(t) ? t : 'info';
}
function Ny(e) {
  return (e.actions ?? []).slice(0, 2).flatMap((t) => {
    const n = t.href;
    return typeof n == 'string' && typeof t.label == 'string'
      ? [{ label: t.label, href: n, action: t }]
      : [];
  });
}
function Cy({ onDismiss: e }) {
  return i.jsx('button', {
    type: 'button',
    className: 'v-notice-dismiss',
    'data-part': 'dismiss',
    'aria-label': 'Dispensar aviso',
    onClick: e,
    children: '×',
  });
}
function sl({ notice: e, onDismiss: t, onAction: n, extra: r }) {
  const l = el(e),
    a = Ny(e);
  return i.jsxs('div', {
    className: `v-notice v-notice-${l}`,
    'data-vendua': 'notice',
    'data-part': 'root',
    'data-kind': e.kind,
    'data-severity': l,
    role: l === 'blocking' ? 'alertdialog' : 'status',
    'aria-modal': l === 'blocking' || void 0,
    'aria-labelledby': `vn-${e.id}`,
    children: [
      i.jsx('strong', {
        className: 'v-notice-title',
        'data-part': 'title',
        id: `vn-${e.id}`,
        children: e.title || 'Aviso',
      }),
      e.body
        ? i.jsx('p', { className: 'v-notice-body', 'data-part': 'body', children: e.body })
        : null,
      r,
      a.length > 0
        ? i.jsx('p', {
            className: 'v-notice-actions',
            'data-part': 'actions',
            children: a.map((o, s) =>
              i.jsx(
                'a',
                {
                  className: 'v-notice-action',
                  href: o.href,
                  onClick: () => (n == null ? void 0 : n(o.action)),
                  children: o.label,
                },
                s,
              ),
            ),
          })
        : null,
      e.dismissible && t && l !== 'blocking' ? i.jsx(Cy, { onDismiss: t }) : null,
    ],
  });
}
function Ey({ notice: e, resumesAt: t, onNotifyMe: n, onDismiss: r }) {
  return i.jsx(sl, {
    notice: e,
    ...(r ? { onDismiss: r } : {}),
    extra: i.jsxs(i.Fragment, {
      children: [
        t
          ? i.jsxs('p', {
              className: 'v-notice-meta',
              'data-part': 'resumes',
              children: ['Volta ', Us(t)],
            })
          : null,
        n
          ? i.jsx('button', {
              type: 'button',
              className: 'v-btn v-btn-accent',
              'data-part': 'notify',
              onClick: n,
              children: 'Avise-me quando voltar',
            })
          : null,
      ],
    }),
  });
}
function _y({ notice: e, opensAt: t, onDismiss: n }) {
  return i.jsx(sl, {
    notice: e,
    ...(n ? { onDismiss: n } : {}),
    extra:
      t && !e.body
        ? i.jsxs('p', {
            className: 'v-notice-meta',
            'data-part': 'opens',
            children: ['Abrimos ', Us(t)],
          })
        : null,
  });
}
function Py(e) {
  return i.jsx(sl, { ...e });
}
function Ty({ notice: e }) {
  return i.jsx(sl, { notice: { ...e, severity: 'blocking', dismissible: !1 } });
}
function Ly({ purposes: e, onAccept: t, onReject: n }) {
  return i.jsxs('section', {
    className: 'v-consent',
    'data-vendua': 'consent',
    'data-part': 'root',
    'aria-label': 'Privacidade',
    children: [
      i.jsxs('p', {
        className: 'v-consent-text',
        'data-part': 'text',
        children: [
          'Usamos dados de navegação para ',
          e.map((r) => r.label.toLowerCase()).join(' e '),
          '. Você escolhe.',
        ],
      }),
      i.jsxs('div', {
        className: 'v-consent-actions',
        'data-part': 'actions',
        children: [
          i.jsx('button', {
            type: 'button',
            className: 'v-btn v-btn-ghost',
            onClick: n,
            children: 'Só o essencial',
          }),
          i.jsx('button', {
            type: 'button',
            className: 'v-btn v-btn-accent',
            onClick: () => t(e.map((r) => r.id)),
            children: 'Aceitar',
          }),
        ],
      }),
    ],
  });
}
function Ry({ error: e, retry: t }) {
  return i.jsxs('div', {
    className: 'v-panel v-error',
    'data-vendua': 'error-fallback',
    'data-part': 'root',
    role: 'alert',
    children: [
      i.jsx('h2', {
        className: 'v-panel-title',
        'data-part': 'title',
        children: 'Algo não carregou',
      }),
      i.jsx('p', {
        className: 'v-muted',
        'data-part': 'body',
        children: e.message || 'Tente de novo em instantes.',
      }),
      i.jsx('button', {
        type: 'button',
        className: 'v-btn v-btn-accent',
        'data-part': 'retry',
        onClick: t,
        children: 'Tentar novamente',
      }),
    ],
  });
}
function by({ path: e, homeHref: t }) {
  return i.jsxs('main', {
    id: 'main',
    className: 'v-page v-not-found',
    'data-vendua-page': 'not-found',
    'data-part': 'root',
    children: [
      i.jsx('h1', {
        className: 'v-page-title',
        'data-part': 'title',
        children: 'Página não encontrada',
      }),
      i.jsxs('p', {
        className: 'v-muted',
        'data-part': 'body',
        children: ['O endereço ', i.jsx('code', { children: e }), ' não existe nesta loja.'],
      }),
      i.jsx('a', {
        className: 'v-btn v-btn-accent',
        href: t,
        'data-part': 'home',
        children: 'Voltar para o início',
      }),
    ],
  });
}
const My = {
  'system.Notice': sl,
  'system.PauseNotice': Ey,
  'system.StoreClosedNotice': _y,
  'system.PromoNotice': Py,
  'system.ConsentBanner': Ly,
  'system.ErrorFallback': Ry,
  'system.NotFound': by,
  'system.EmergencyOverlay': Ty,
  'checkout.Layout': iy,
  'checkout.Summary': sy,
  'checkout.AddressForm': uy,
  'checkout.DeliveryOptions': cy,
  'checkout.PaymentMethods': dy,
  'checkout.SuccessPage': fy,
  'checkout.EmptyCart': py,
  'cart.Drawer': my,
  'cart.LineItem': gy,
  'order.StatusPage': yy,
  'order.Timeline': vy,
  'store.HoursTable': wy,
  'catalog.ProductCard': ky,
  'catalog.ModifierPicker': jy,
};
class Vs extends x.Component {
  constructor() {
    super(...arguments);
    kn(this, 'state', { failed: !1, key: this.props.resetKey });
  }
  static getDerivedStateFromError() {
    return { failed: !0 };
  }
  static getDerivedStateFromProps(n, r) {
    return n.resetKey !== r.key ? { failed: !1, key: n.resetKey } : null;
  }
  componentDidCatch(n) {
    this.props.onError
      ? this.props.onError(n)
      : console.error('[vendua] render failed, showing the Kernel fallback', n);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
const Cc = new WeakMap();
function Oy(e) {
  let t = Cc.get(e);
  return (t || Cc.set(e, (t = x.lazy(e))), t);
}
function Iy(e) {
  const { config: t } = J(),
    n = x.useMemo(() => {
      var l, a;
      const r = (l = t.overrides) == null ? void 0 : l[e];
      if (r) return r;
      for (const [o, s] of Object.entries(Bv))
        if (s.to === e && (a = t.overrides) != null && a[o]) return t.overrides[o];
    }, [t, e]);
  return n ? Oy(n) : null;
}
function B({ name: e, ...t }) {
  const n = My[e],
    r = Iy(e),
    l = t,
    a = i.jsx(n, { ...l });
  return r
    ? i.jsx(Vs, {
        fallback: a,
        onError: (o) =>
          Wa({
            kind: 'slot_error',
            target: e,
            message: o instanceof Error ? o.message : String(o),
          }),
        children: i.jsx(x.Suspense, { fallback: a, children: i.jsx(r, { ...l }) }),
      })
    : a;
}
function X() {
  var n, r;
  const { api: e } = J(),
    t = _t('store', () => e.store());
  return {
    store: t.data,
    status: (n = t.data) == null ? void 0 : n.status,
    resumesAt: (r = t.data) == null ? void 0 : r.resumesAt,
    loading: t.loading,
    error: t.error,
    refetch: t.refetch,
  };
}
function ul() {
  var n;
  const { api: e } = J(),
    t = _t('catalog', () => e.catalog());
  return {
    categories: ((n = t.data) == null ? void 0 : n.categories) ?? [],
    loading: t.loading,
    error: t.error,
    refetch: t.refetch,
  };
}
function Hs(e) {
  var a;
  const { api: t } = J(),
    n = _t(`product:${e}`, () => t.product(e)),
    r = (a = n.data) == null ? void 0 : a.product,
    l = x.useRef(null);
  return (
    x.useEffect(() => {
      !r ||
        l.current === r.id ||
        ((l.current = r.id), Qe('product_view', { product_id: r.id, slug: r.slug }));
    }, [r]),
    { product: r, loading: n.loading, error: n.error, refetch: n.refetch }
  );
}
function Ay() {
  var n;
  const { api: e } = J(),
    t = _t('zones', () => e.zones());
  return {
    zones: ((n = t.data) == null ? void 0 : n.zones) ?? [],
    loading: t.loading,
    error: t.error,
    refetch: t.refetch,
  };
}
function pt() {
  const { api: e, invalidate: t } = J(),
    n = _t('cart', () => (e.sessionToken ? e.cart().then((a) => a.cart) : Promise.resolve(null))),
    r = x.useCallback((a) => ($s('cart', a), t('cart'), a), [t]),
    l = x.useMemo(
      () => ({
        add: (a, o = 1, s = []) => e.addItem(a, o, s).then(r),
        updateQty: (a, o) => e.updateItem(a, o).then(r),
        remove: (a) => e.removeItem(a).then(r),
        setDelivery: (a) => e.setDelivery(a).then(r),
      }),
      [e, r],
    );
  return {
    cart: n.data ?? null,
    loading: n.loading,
    error: n.error,
    mutations: l,
    refetch: n.refetch,
  };
}
function Dy(e) {
  const { api: t } = J(),
    n = _t(`order:${e}`, () => t.order(e));
  return { order: n.data, loading: n.loading, error: n.error, refetch: n.refetch };
}
function zy() {
  const { api: e, invalidate: t } = J(),
    [n, r] = x.useState(!1),
    [l, a] = x.useState();
  return {
    submit: x.useCallback(
      async (s) => {
        (r(!0), a(void 0), Qe('payment_submit', { method: s.payment.method }));
        try {
          const u = await e.checkout(s);
          return ($s('cart'), t('cart'), u);
        } catch (u) {
          const c =
            u instanceof Zr
              ? { status: u.status, code: u.code, message: u.message, details: u.details }
              : { code: 'INTERNAL', message: u instanceof Error ? u.message : 'checkout failed' };
          throw (a(c), Qe('order_failed', { code: c.code }), u);
        } finally {
          r(!1);
        }
      },
      [e, t],
    ),
    pending: n,
    error: l,
    reset: x.useCallback(() => a(void 0), []),
  };
}
const zi = 'vendua.customer';
let nn;
const Ml = new Set();
function By() {
  var e;
  if (nn !== void 0) return nn;
  try {
    const t = (e = globalThis.localStorage) == null ? void 0 : e.getItem(zi),
      n = t ? JSON.parse(t) : null;
    nn = n && typeof n.name == 'string' && typeof n.phone == 'string' ? n : null;
  } catch {
    nn = null;
  }
  return nn;
}
function Fy() {
  const e = x.useSyncExternalStore(
      (r) => (Ml.add(r), () => Ml.delete(r)),
      By,
      () => null,
    ),
    t = x.useCallback((r) => {
      var a;
      const l = {
        name: r.name.slice(0, 120),
        phone: r.phone.replace(/\D/g, '').slice(0, 13),
        address: {
          street: r.address.street.slice(0, 120),
          number: r.address.number.slice(0, 10),
          neighborhood: r.address.neighborhood.slice(0, 80),
          complement: r.address.complement.slice(0, 80),
        },
      };
      nn = l;
      try {
        (a = globalThis.localStorage) == null || a.setItem(zi, JSON.stringify(l));
      } catch {}
      Ml.forEach((o) => o());
    }, []),
    n = x.useCallback(() => {
      var r;
      nn = null;
      try {
        (r = globalThis.localStorage) == null || r.removeItem(zi);
      } catch {}
      Ml.forEach((l) => l());
    }, []);
  return { customer: e, status: e ? 'remembered' : 'guest', remember: t, forget: n };
}
function $y() {
  return { consent: x.useSyncExternalStore(ey, ty, () => null), decide: Zv };
}
function Uy() {
  const { api: e } = J(),
    t = e.orderIds().slice(0, 20),
    n = _t(`orders:${t.join(',')}`, async () =>
      (await Promise.allSettled(t.map((l) => e.order(l)))).flatMap((l) =>
        l.status === 'fulfilled' ? [l.value] : [],
      ),
    );
  return { orders: n.data ?? [], loading: n.loading, refetch: n.refetch };
}
const Ec = new Set();
function Ws({ notice: e, onDismiss: t }) {
  var a;
  x.useEffect(() => {
    Ec.has(e.id) || (Ec.add(e.id), Qe('notice_shown', { kind: e.kind, severity: el(e) }));
  }, [e]);
  const n = (o) => Qe('notice_action', { kind: e.kind, severity: el(e), action: o.type }),
    r = t ? { onDismiss: t } : {},
    l =
      typeof ((a = e.payload) == null ? void 0 : a.resumesAt) == 'string'
        ? e.payload.resumesAt
        : void 0;
  switch (e.kind) {
    case 'store_paused':
      return i.jsx(B, {
        name: 'system.PauseNotice',
        notice: e,
        actions: e.actions ?? [],
        ...(l ? { resumesAt: l } : {}),
        ...r,
      });
    case 'store_closed':
      return i.jsx(B, {
        name: 'system.StoreClosedNotice',
        notice: e,
        ...(l ? { opensAt: l } : {}),
        ...r,
      });
    case 'promo':
    case 'promo_notice':
      return i.jsx(B, { name: 'system.PromoNotice', notice: e, ...r });
    case 'emergency':
      return i.jsx(B, { name: 'system.EmergencyOverlay', notice: e });
    default:
      return i.jsx(B, { name: 'system.Notice', notice: e, onAction: n, ...r });
  }
}
function Vy({ notice: e }) {
  const [t, n] = x.useState(!1);
  return t ? null : i.jsx(Ws, { notice: e, onDismiss: () => n(!0) });
}
const Hy = { analytics: 'Métricas de uso', marketing: 'Ofertas personalizadas' };
function Wy() {
  var l;
  const { config: e } = J(),
    { consent: t, decide: n } = $y(),
    r = ((l = e.consent) == null ? void 0 : l.purposes) ?? [];
  return r.length === 0 || t
    ? null
    : i.jsx(B, {
        name: 'system.ConsentBanner',
        purposes: r.map((a) => ({ id: a, label: Hy[a] })),
        onAccept: (a) => n(a),
        onReject: () => n([]),
      });
}
function Qy({ notices: e }) {
  const t = x.useRef(null);
  return (
    x.useEffect(() => {
      var n, r, l, a;
      ((r = (n = t.current) == null ? void 0 : n.querySelector('[role="alertdialog"]')) == null ||
        r.setAttribute('tabindex', '-1'),
        (a = (l = t.current) == null ? void 0 : l.querySelector('[role="alertdialog"]')) == null ||
          a.focus({ preventScroll: !0 }));
    }, [e.length]),
    i.jsx('div', {
      className: 'v-blocking-overlay',
      'data-vendua': 'blocking-overlay',
      ref: t,
      children: e.map((n) => i.jsx(Ws, { notice: n }, n.id)),
    })
  );
}
function Ky({ zoneMatched: e } = {}) {
  const { api: t } = J(),
    n = globalThis.__VENDUA_STATE__,
    r = `surfaces:${e === void 0 ? 'any' : e}`,
    a = _t(r, () => t.surfaces(e)).data ?? (e === void 0 ? n : void 0),
    o = Kv(),
    [, s] = x.useState(0);
  x.useEffect(() => {
    if (!a) return;
    const f = Date.now();
    let v = 1 / 0;
    for (const w of a.notices)
      for (const j of [w.startsAt, w.endsAt]) {
        if (!j) continue;
        const h = Date.parse(j);
        h > f && h < v && (v = h);
      }
    if (v === 1 / 0) return;
    const k = setTimeout(() => s((w) => w + 1), Math.min(v - f + 50, 2 ** 31 - 1));
    return () => clearTimeout(k);
  }, [a]);
  const u = Date.now(),
    c = ((a == null ? void 0 : a.notices) ?? []).filter(
      (f) =>
        (!f.startsAt || Date.parse(f.startsAt) <= u) && (!f.endsAt || Date.parse(f.endsAt) > u),
    ),
    m = c.filter((f) => el(f) === 'blocking'),
    d = c.filter((f) => el(f) !== 'blocking');
  return i.jsxs(i.Fragment, {
    children: [
      i.jsxs('div', {
        className: 'v-banner-stack',
        'data-vendua': 'banner-stack',
        'aria-live': 'polite',
        children: [
          d.map((f) => i.jsx(Vy, { notice: f }, f.id)),
          o.map((f) => i.jsx(Ws, { notice: f, onDismiss: () => up(f.id) }, f.id)),
        ],
      }),
      m.length > 0 ? i.jsx(Qy, { notices: m }) : null,
      i.jsx(Wy, {}),
    ],
  });
}
const mp = 'sdk:page-content';
function qy(e) {
  return e.startsWith('page:') ? e.slice(5) : null;
}
const Yy = {
  layout: {
    version: 1,
    page: 'layout',
    sections: [
      { id: 'header', type: 'sdk:header' },
      { id: 'content', type: 'sdk:page-content' },
      { id: 'footer', type: 'sdk:footer' },
    ],
  },
  home: { version: 1, page: 'home', sections: [{ id: 'catalog', type: 'sdk:catalog-grid' }] },
  catalog: {
    version: 1,
    page: 'catalog',
    sections: [
      { id: 'catalog', type: 'sdk:catalog-grid', settings: { title: 'Cardápio', showSearch: !0 } },
    ],
  },
  product: {
    version: 1,
    page: 'product',
    sections: [{ id: 'purchase', type: 'sdk:purchase-panel' }],
  },
};
function Jy(e) {
  if (!e || typeof e != 'object') return !1;
  const t = e;
  return (
    typeof t.default == 'function' &&
    !!t.schema &&
    (t.schema.kind === 'section' || t.schema.kind === 'block')
  );
}
function Gy(e, t) {
  const n = new Map();
  for (const r of e) n.set(r.schema.type, r);
  for (const [r, l] of Object.entries(t)) {
    if (!Jy(l)) {
      console.warn(
        `[vendua] ${r}: not a section module (needs \`export const schema\` + default component)`,
      );
      continue;
    }
    if (!l.schema.type.startsWith('store:')) {
      console.warn(
        `[vendua] ${r}: store sections must use a 'store:' type, got '${l.schema.type}'`,
      );
      continue;
    }
    n.set(l.schema.type, { schema: l.schema, Component: l.default, source: 'store' });
  }
  return n;
}
const E = (e) => ({ kind: 'text', ...e }),
  Xy = (e) => ({ kind: 'richText', ...e }),
  Ka = (e) => ({ kind: 'number', ...e }),
  et = (e = {}) => ({ kind: 'boolean', ...e }),
  tt = (e, t) => ({ kind: 'select', options: e, ...t }),
  cl = (e = {}) => ({ kind: 'image', ...e }),
  Me = (e = {}) => ({ kind: 'url', ...e }),
  Zy = (e = {}) => ({ kind: 'product', ...e }),
  gp = (e = {}) => ({ kind: 'category', ...e }),
  vn = (e, t) => ({ kind: 'list', of: e, ...t });
function ne(e) {
  return { kind: 'section', ...e };
}
function dl(e) {
  return { kind: 'block', ...e };
}
const e0 = /^[a-z0-9][a-z0-9-]{0,99}$/,
  t0 = /^(\/(?!\/)|https:\/\/|#|mailto:|tel:|https:\/\/wa\.me\/)/;
function n0(e, t) {
  switch (e.kind) {
    case 'text':
    case 'richText':
      return typeof t == 'string' && t.length <= e.max ? t : e.default;
    case 'number':
      return typeof t == 'number' && Number.isFinite(t) && t >= e.min && t <= e.max ? t : e.default;
    case 'boolean':
      return typeof t == 'boolean' ? t : e.default;
    case 'select':
      return typeof t == 'string' && e.options.includes(t) ? t : e.default;
    case 'image':
    case 'url':
      return typeof t == 'string' && t.length <= 500 && t0.test(t) ? t : e.default;
    case 'product':
    case 'category':
      return typeof t == 'string' && e0.test(t) ? t : e.default;
    case 'list':
      return Array.isArray(t)
        ? t
            .slice(0, e.max)
            .filter((n) => n && typeof n == 'object' && !Array.isArray(n))
            .map((n) => Qs(e.of, n))
        : e.default;
  }
}
function Qs(e, t) {
  const n = {};
  for (const [r, l] of Object.entries(e)) {
    const a = n0(l, t == null ? void 0 : t[r]);
    a !== void 0 && (n[r] = a);
  }
  return n;
}
const vp = x.createContext(null),
  yp = x.createContext({ page: 'home', params: {} }),
  Ks = x.createContext(null);
function fl() {
  return x.useContext(yp);
}
function xp({ value: e, children: t }) {
  return i.jsx(yp.Provider, { value: e, children: t });
}
function qa() {
  return x.useContext(vp) ?? r0;
}
const r0 = new Map();
function l0({ sdk: e, children: t }) {
  const { storefront: n } = J(),
    r = x.useMemo(() => Gy(e, n.sections), [e, n]);
  return i.jsx(vp.Provider, { value: r, children: t });
}
const _c = new Set();
function a0(e, t, n) {
  _c.has(`${e}:${t}`) || (_c.add(`${e}:${t}`), Wa({ kind: e, target: t, message: n }));
}
function wp() {
  const { api: e, storefront: t } = J(),
    n = _t('state:templates', () => e.state(!0));
  return x.useMemo(() => {
    var r;
    return {
      ...Yy,
      ...t.snapshot.templates,
      ...(((r = n.data) == null ? void 0 : r.templates) ?? {}),
    };
  }, [t, n.data]);
}
function kp(e) {
  return wp()[e];
}
function jp({ kind: e, type: t }) {
  return (
    x.useEffect(() => {
      a0(
        e,
        t,
        `no ${e === 'section_unknown' ? 'section' : 'block'} registered for '${t}' in this build`,
      );
    }, [e, t]),
    null
  );
}
function o0({ instance: e }) {
  const n = qa().get(e.type);
  if (!n || n.schema.kind !== 'section')
    return i.jsx(jp, { kind: 'section_unknown', type: e.type });
  const r = Qs(n.schema.settings, e.settings),
    { Component: l } = n;
  return i.jsx(Vs, {
    fallback: null,
    resetKey: e,
    onError: (a) =>
      Wa({
        kind: 'section_error',
        target: `${e.type}#${e.id}`,
        message: a instanceof Error ? a.message : String(a),
      }),
    children: i.jsx(Ks.Provider, {
      value: { instance: e, schema: n.schema },
      children: i.jsx('div', {
        'data-section': e.type,
        'data-section-id': e.id,
        style: { display: 'contents' },
        children: i.jsx(l, { settings: r, id: e.id }),
      }),
    }),
  });
}
function i0({ instance: e }) {
  const n = qa().get(e.type);
  if (!n || n.schema.kind !== 'block') return i.jsx(jp, { kind: 'block_unknown', type: e.type });
  const r = Qs(n.schema.settings, e.settings),
    { Component: l } = n;
  return i.jsx(Vs, {
    fallback: null,
    resetKey: e,
    onError: (a) =>
      Wa({
        kind: 'section_error',
        target: `${e.type}#${e.id}`,
        message: a instanceof Error ? a.message : String(a),
      }),
    children: i.jsx('div', {
      'data-block': e.type,
      'data-block-id': e.id,
      style: { display: 'contents' },
      children: i.jsx(l, { settings: r, id: e.id }),
    }),
  });
}
function s0(e, t) {
  var l;
  const n = x.useContext(Ks),
    r = qa();
  return (((l = n == null ? void 0 : n.instance.blocks) == null ? void 0 : l[e]) ?? []).some(
    (a) => {
      const o = r.get(a.type);
      return (o == null ? void 0 : o.schema.kind) === 'block' && o.schema.category === t;
    },
  );
}
function Ue({ name: e, className: t, only: n }) {
  var u, c;
  const r = x.useContext(Ks),
    l = qa();
  if (!r) return null;
  const a = (u = r.schema.areas) == null ? void 0 : u[e],
    o = ((c = r.instance.blocks) == null ? void 0 : c[e]) ?? [];
  if (!a || o.length === 0) return null;
  const s = o
    .filter((m) => {
      const d = l.get(m.type);
      return d
        ? d.schema.kind === 'block' &&
            a.accepts.includes(d.schema.category) &&
            (!n || n.includes(d.schema.category))
        : !n;
    })
    .slice(0, a.max ?? 1 / 0);
  return s.length === 0
    ? null
    : i.jsx('div', {
        className: t,
        'data-area': e,
        children: s.map((m) => i.jsx(i0, { instance: m }, m.id)),
      });
}
function Sp({ template: e, only: t }) {
  return i.jsx(i.Fragment, {
    children: e.sections
      .filter((n) => (!n.disabled || n.type === mp) && (t ? t(n) : !0))
      .map((n) => i.jsx(o0, { instance: n }, n.id)),
  });
}
function pl(e, t, n, r = 'button') {
  if (e && x.isValidElement(n)) {
    const l = n,
      a = l.props,
      o = { ...t, ...a };
    return (
      t['data-vendua'] && (o['data-vendua'] = t['data-vendua']),
      (typeof t.onClick == 'function' || typeof a.onClick == 'function') &&
        (o.onClick = (s) => {
          var u, c;
          ((u = t.onClick) == null || u.call(t, s), (c = a.onClick) == null || c.call(a, s));
        }),
      (t.className || a.className) &&
        (o.className = [t.className, a.className].filter(Boolean).join(' ')),
      (t.disabled || a.disabled) && (o.disabled = !0),
      x.cloneElement(l, o)
    );
  }
  return r === 'a'
    ? i.jsx('a', { ...t, children: n })
    : i.jsx('button', { type: 'button', ...t, children: n });
}
function yn() {
  const e = x.useContext(dt);
  return (t) => {
    var n;
    e != null && e.navigator
      ? e.navigator.push(t)
      : (n = globalThis.location) == null || n.assign(t);
  };
}
const u0 = (e) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
function qs({ product: e, asChild: t, children: n, className: r, prefetch: l = !0 }) {
  const { config: a, api: o } = J(),
    s = yn(),
    u = ap(a, e.slug),
    c = () => {
      l && oy(o, `product:${e.slug}`, () => o.product(e.slug));
    };
  return pl(
    t,
    {
      'data-vendua': 'product-link',
      href: u,
      ...(r ? { className: r } : {}),
      onMouseEnter: c,
      onFocus: c,
      onTouchStart: c,
      onClick: (m) => {
        u0(m) && (m.preventDefault(), s(u));
      },
    },
    n ?? e.name ?? e.slug,
    'a',
  );
}
function c0({
  product: e,
  qty: t = 1,
  modifierIds: n = [],
  asChild: r,
  children: l,
  onAdded: a,
  onError: o,
}) {
  const { status: s } = X(),
    { mutations: u } = pt(),
    [c, m] = x.useState(!1),
    d = e.status !== 'active',
    f = c || d || s === 'paused';
  return pl(
    r,
    {
      'data-vendua': 'add-to-cart',
      'data-state': d ? 'sold-out' : c ? 'pending' : 'idle',
      disabled: f,
      'aria-disabled': f,
      'aria-busy': c || void 0,
      onClick: async () => {
        if (!f) {
          m(!0);
          try {
            (await u.add(e.id, t, n),
              Qe('add_to_cart', {
                product_id: e.id,
                qty: t,
                modifiers: n.length,
                ...(e.basePriceCents !== void 0 ? { value: e.basePriceCents * t } : {}),
              }),
              a == null || a());
          } catch (k) {
            o ? o(k) : Ha(k);
          } finally {
            m(!1);
          }
        }
      },
    },
    l ?? (d ? 'Esgotado' : 'Adicionar'),
  );
}
function Ya({ asChild: e, children: t, onOpen: n }) {
  const { cart: r } = pt(),
    l = yn(),
    a = (r == null ? void 0 : r.status) === 'open' ? r.totals.itemCount : 0;
  return pl(
    e,
    {
      'data-vendua': 'cart-trigger',
      'data-count': a,
      'aria-label': `sacola, ${a} ${a === 1 ? 'item' : 'itens'}`,
      onClick: (o) => {
        if (
          (Qe('cart_open', {
            item_count: a,
            cart_value: (r == null ? void 0 : r.totals.totalCents) ?? 0,
          }),
          n)
        )
          return n();
        (o && 'preventDefault' in o && o.preventDefault(), l(ot.cart));
      },
    },
    t ?? i.jsxs(i.Fragment, { children: ['Sacola (', a, ')'] }),
  );
}
function d0({ asChild: e, children: t, onStart: n, className: r }) {
  const { api: l } = J(),
    { status: a } = X(),
    { cart: o } = pt(),
    s = yn(),
    [u, c] = x.useState(!1),
    d =
      !o || o.status !== 'open' || o.items.length === 0 || a === 'paused' || o.totals.belowMinOrder,
    f = u || d;
  return pl(
    e,
    {
      'data-vendua': 'checkout-button',
      'data-state': u ? 'pending' : d ? 'blocked' : 'idle',
      disabled: f,
      'aria-disabled': f,
      ...(r ? { className: r } : {}),
      onClick: async () => {
        if (!f) {
          c(!0);
          try {
            (await l.ensureSession(),
              Qe('checkout_start', { cart_value: (o == null ? void 0 : o.totals.totalCents) ?? 0 }),
              n ? n() : s(ot.checkout));
          } catch (v) {
            Ha(v);
          } finally {
            c(!1);
          }
        }
      },
    },
    t ?? 'Ir para o pagamento',
  );
}
function f0({
  subject: e,
  productId: t,
  phone: n,
  asChild: r,
  children: l,
  onSubscribed: a,
  onError: o,
}) {
  const { api: s } = J(),
    [u, c] = x.useState('idle'),
    m = n.replace(/\D/g, ''),
    d = m.length >= 10 && m.length <= 13 && (e === 'store' || !!t),
    f = u !== 'idle' || !d;
  return pl(
    r,
    {
      'data-vendua': 'notify-me',
      'data-state': u,
      disabled: f,
      'aria-disabled': f,
      onClick: async () => {
        if (!f) {
          c('pending');
          try {
            (await s.notifyMe({ subject: e, phone: m, ...(t ? { productId: t } : {}) }),
              Qe('notify_me', { subject: e, ...(t ? { product_id: t } : {}) }),
              c('done'),
              a == null || a());
          } catch (v) {
            (c('idle'), o ? o(v) : Ha(v));
          }
        }
      },
    },
    l ?? (u === 'done' ? 'Pronto, vamos avisar' : 'Avise-me'),
  );
}
function Ys() {
  const { status: e, resumesAt: t, store: n } = X(),
    r = e === 'open' ? 'Aberto' : e === 'paused' ? 'Pausado' : 'Fechado',
    l = t
      ? new Intl.DateTimeFormat('pt-BR', {
          timeZone: n == null ? void 0 : n.hours.timezone,
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(t))
      : void 0;
  return i.jsx('span', {
    'data-vendua': 'store-status',
    'data-status': e ?? 'loading',
    role: 'status',
    'aria-live': 'polite',
    title: l ? `retorna ${l}` : n == null ? void 0 : n.name,
    children: e ? r : '…',
  });
}
function Np() {
  const { params: e } = fl();
  return Hs(e.slug ?? '').product;
}
function p0({ settings: e }) {
  const t = Np();
  if (!t) return null;
  if (t.status === 'sold_out')
    return i.jsx('p', {
      className: 'v-stock',
      'data-part': 'root',
      'data-tone': 'low',
      role: 'status',
      children: 'Esgotado hoje',
    });
  const n = t.stockQuantity;
  if (typeof n != 'number') return null;
  const r = n > 0 && n <= e.threshold;
  return !r && !e.showWhenPlenty
    ? null
    : i.jsx('p', {
        className: 'v-stock',
        'data-part': 'root',
        'data-tone': r ? 'low' : 'ok',
        role: 'status',
        children: r
          ? `Restam ${n} ${n === 1 ? 'unidade' : 'unidades'}`
          : `${n} unidades disponíveis`,
      });
}
function h0({ settings: e }) {
  const t = Np(),
    { status: n } = X(),
    [r, l] = x.useState(''),
    [a, o] = x.useState(!1),
    s =
      (t == null ? void 0 : t.status) === 'sold_out' ? 'product' : n === 'paused' ? 'store' : null;
  return s
    ? a
      ? i.jsx('p', {
          className: 'v-note',
          role: 'status',
          'data-part': 'done',
          children: e.successText,
        })
      : i.jsxs('div', {
          className: 'v-notify',
          'data-part': 'root',
          children: [
            i.jsx('label', { className: 'v-label', htmlFor: 'v-notify-phone', children: e.title }),
            i.jsxs('div', {
              className: 'v-notify-row',
              children: [
                i.jsx('input', {
                  id: 'v-notify-phone',
                  type: 'tel',
                  inputMode: 'tel',
                  autoComplete: 'tel',
                  className: 'v-input',
                  placeholder: 'Seu WhatsApp',
                  maxLength: 20,
                  value: r,
                  onChange: (u) => l(u.target.value),
                }),
                i.jsx(f0, {
                  subject: s,
                  ...(s === 'product' && t ? { productId: t.id } : {}),
                  phone: r,
                  onSubscribed: () => o(!0),
                  asChild: !0,
                  children: i.jsx('button', {
                    type: 'button',
                    className: 'v-btn v-btn-accent',
                    children: 'Avise-me',
                  }),
                }),
              ],
            }),
          ],
        })
    : null;
}
function m0({ settings: e }) {
  return e.text
    ? i.jsx('span', {
        className: 'v-badge',
        'data-part': 'root',
        'data-tone': e.tone,
        children: e.text,
      })
    : null;
}
const g0 = ne({ type: 'sdk:page-content', settings: {} }),
  v0 = ne({
    type: 'sdk:header',
    settings: {
      brand: E({ max: 60 }),
      logo: Me(),
      links: vn({ label: E({ max: 40, default: '' }), href: Me({ default: '/' }) }, { max: 6 }),
      showStatus: et({ default: !0 }),
      cartLabel: E({ max: 30, default: 'Sacola' }),
    },
    areas: { actions: { accepts: ['badge', 'info'], max: 2 } },
  }),
  y0 = ne({
    type: 'sdk:footer',
    settings: {
      note: E({ max: 160 }),
      showHours: et({ default: !0 }),
      showContacts: et({ default: !0 }),
      links: vn({ label: E({ max: 40, default: '' }), href: Me({ default: '/' }) }, { max: 8 }),
    },
    areas: { extra: { accepts: ['info', 'social-proof', 'promo'], max: 3 } },
  }),
  x0 = ne({
    type: 'sdk:announcement-bar',
    settings: {
      text: E({ max: 140, default: '' }),
      href: Me(),
      linkLabel: E({ max: 40 }),
      tone: tt(['accent', 'surface'], { default: 'accent' }),
    },
  }),
  w0 = ne({
    type: 'sdk:header-cart',
    settings: {
      label: E({ max: 30, default: 'Sacola' }),
      variant: tt(['pill', 'text'], { default: 'pill' }),
    },
  }),
  k0 = ne({
    type: 'sdk:purchase-panel',
    settings: {
      variant: tt(['split', 'compact', 'editorial'], { default: 'split' }),
      product: Zy(),
      showDescription: et({ default: !0 }),
      addLabel: E({ max: 40, default: 'Adicionar à sacola' }),
      backLabel: E({ max: 40, default: 'Voltar ao cardápio' }),
      soldOutText: E({ max: 80, default: 'Esgotado no momento.' }),
      afterAdd: tt(['cart', 'stay'], { default: 'cart' }),
    },
    areas: {
      media: { accepts: ['media', 'badge'], max: 3 },
      'after-price': { accepts: ['purchase-extras', 'badge', 'promo', 'info'], max: 4 },
      'after-cta': { accepts: ['purchase-extras', 'info', 'social-proof'], max: 4 },
    },
  }),
  j0 = ne({
    type: 'sdk:catalog-grid',
    settings: {
      eyebrow: E({ max: 60 }),
      title: E({ max: 80 }),
      intro: E({ max: 240 }),
      variant: tt(['grid', 'list'], { default: 'grid' }),
      showSearch: et({ default: !1 }),
      searchLabel: E({ max: 60, default: 'Buscar no cardápio' }),
      showCategoryTabs: et({ default: !0 }),
      allLabel: E({ max: 40, default: 'Tudo' }),
      emptyText: E({ max: 160, default: 'O cardápio ainda está vazio.' }),
    },
    areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
  }),
  S0 = ne({
    type: 'sdk:product-list',
    settings: {
      eyebrow: E({ max: 60 }),
      title: E({ max: 80 }),
      intro: E({ max: 240 }),
      category: gp(),
      limit: Ka({ min: 1, max: 12, default: 4 }),
      variant: tt(['grid', 'list'], { default: 'grid' }),
      ctaLabel: E({ max: 40 }),
      ctaHref: Me(),
    },
  }),
  N0 = ne({
    type: 'sdk:store-status',
    settings: {
      title: E({ max: 80, default: 'Horários' }),
      showHours: et({ default: !0 }),
      showAddress: et({ default: !0 }),
      variant: tt(['card', 'inline'], { default: 'card' }),
    },
  }),
  C0 = ne({
    type: 'sdk:rich-text',
    settings: { eyebrow: E({ max: 60 }), title: E({ max: 120 }), body: Xy({ max: 4e3 }) },
  }),
  E0 = dl({
    type: 'sdk:stock-counter',
    category: 'purchase-extras',
    settings: {
      threshold: Ka({ min: 1, max: 50, default: 5 }),
      showWhenPlenty: et({ default: !1 }),
    },
  }),
  _0 = dl({
    type: 'sdk:notify-me',
    category: 'purchase-extras',
    settings: {
      title: E({ max: 80, default: 'Esgotou? A gente te avisa quando voltar.' }),
      successText: E({ max: 120, default: 'Pronto! Você recebe uma mensagem quando voltar.' }),
    },
  }),
  P0 = dl({
    type: 'sdk:promo-badge',
    category: 'badge',
    settings: {
      text: E({ max: 40, default: '' }),
      tone: tt(['accent', 'surface'], { default: 'accent' }),
    },
  });
function ct({ href: e, className: t, children: n, ...r }) {
  const l = yn(),
    a = e.startsWith('/') && !e.startsWith('//');
  return i.jsx('a', {
    ...r,
    href: e,
    className: t,
    onClick: (o) => {
      !a ||
        o.button !== 0 ||
        o.metaKey ||
        o.ctrlKey ||
        o.shiftKey ||
        o.altKey ||
        (o.preventDefault(), l(e));
    },
    children: n,
  });
}
function Js({ eyebrow: e, title: t, intro: n, as: r = 'h2' }) {
  if (!e && !t && !n) return null;
  const l = r;
  return i.jsxs('header', {
    className: 'v-section-head',
    'data-part': 'head',
    children: [
      e ? i.jsx('p', { className: 'v-eyebrow', children: e }) : null,
      t
        ? i.jsx(l, { className: r === 'h1' ? 'v-page-title' : 'v-section-title', children: t })
        : null,
      n ? i.jsx('p', { className: 'v-muted', children: n }) : null,
    ],
  });
}
function T0() {
  return i.jsx(wv, {});
}
function L0({ settings: e }) {
  var a;
  const { store: t } = X(),
    { cart: n } = pt(),
    r = (n == null ? void 0 : n.status) === 'open' ? n.totals.itemCount : 0,
    l = e.brand || (t == null ? void 0 : t.name) || 'Loja';
  return i.jsxs('header', {
    className: 'v-header',
    'data-part': 'root',
    children: [
      i.jsx('a', {
        href: '#main',
        className: 'v-sr',
        'data-part': 'skip',
        children: 'Pular para o conteúdo',
      }),
      i.jsxs('div', {
        className: 'v-header-inner',
        children: [
          i.jsxs(ct, {
            href: '/',
            className: 'v-brand',
            'data-part': 'brand',
            'aria-label': `${l} — início`,
            children: [
              e.logo
                ? i.jsx('img', { src: e.logo, alt: '', height: 36, 'data-part': 'logo' })
                : null,
              i.jsx('span', { children: l }),
            ],
          }),
          (a = e.links) != null && a.length
            ? i.jsx('nav', {
                className: 'v-nav',
                'aria-label': 'Navegação principal',
                'data-part': 'nav',
                children: e.links.map((o, s) => i.jsx(ct, { href: o.href, children: o.label }, s)),
              })
            : null,
          i.jsxs('div', {
            className: 'v-header-actions',
            'data-part': 'actions',
            children: [
              i.jsx(Ue, { name: 'actions' }),
              e.showStatus ? i.jsx(Ys, {}) : null,
              i.jsx(Ya, {
                asChild: !0,
                children: i.jsxs('button', {
                  type: 'button',
                  className: 'v-cart-pill',
                  'data-part': 'cart',
                  children: [
                    e.cartLabel,
                    ' ',
                    i.jsx('span', { className: 'v-cart-count', children: r }),
                  ],
                }),
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function R0({ settings: e }) {
  var l, a, o;
  const { store: t } = X(),
    n = (l = t == null ? void 0 : t.whatsapp) == null ? void 0 : l.replace(/\D/g, ''),
    r = (a = t == null ? void 0 : t.instagram) == null ? void 0 : a.replace(/^@/, '');
  return i.jsx('footer', {
    className: 'v-footer',
    'data-part': 'root',
    children: i.jsxs('div', {
      className: 'v-footer-inner',
      children: [
        i.jsxs('div', {
          'data-part': 'about',
          children: [
            i.jsx('p', {
              style: { fontWeight: 600 },
              children: (t == null ? void 0 : t.name) ?? '',
            }),
            e.note ? i.jsx('p', { className: 'v-muted', children: e.note }) : null,
            t != null && t.address
              ? i.jsxs('p', {
                  className: 'v-muted',
                  children: [t.address, t.city ? `, ${t.city}` : ''],
                })
              : null,
            e.showContacts
              ? i.jsxs('p', {
                  className: 'v-footer-contacts',
                  'data-part': 'contacts',
                  children: [
                    n
                      ? i.jsx('a', {
                          href: `https://wa.me/${n}`,
                          rel: 'noopener noreferrer',
                          target: '_blank',
                          children: 'WhatsApp',
                        })
                      : null,
                    n && r ? ' · ' : null,
                    r
                      ? i.jsxs('a', {
                          href: `https://www.instagram.com/${r}/`,
                          rel: 'noopener noreferrer',
                          target: '_blank',
                          children: ['Instagram @', r],
                        })
                      : null,
                  ],
                })
              : null,
            (o = e.links) != null && o.length
              ? i.jsx('nav', {
                  'aria-label': 'Links do rodapé',
                  'data-part': 'links',
                  children: e.links.map((s, u) =>
                    i.jsx('p', { children: i.jsx(ct, { href: s.href, children: s.label }) }, u),
                  ),
                })
              : null,
            i.jsx(Ue, { name: 'extra' }),
          ],
        }),
        e.showHours && t
          ? i.jsx('div', {
              'data-part': 'hours',
              children: i.jsx(B, { name: 'store.HoursTable', hours: t.hours, status: t.status }),
            })
          : null,
      ],
    }),
  });
}
function b0({ settings: e }) {
  return e.text
    ? i.jsxs('div', {
        className: 'v-announcement',
        'data-part': 'root',
        'data-tone': e.tone,
        role: 'region',
        'aria-label': 'Aviso da loja',
        children: [
          i.jsx('span', { children: e.text }),
          e.href && e.linkLabel ? i.jsx(ct, { href: e.href, children: e.linkLabel }) : null,
        ],
      })
    : null;
}
function M0({ settings: e }) {
  const { cart: t } = pt(),
    n = (t == null ? void 0 : t.status) === 'open' ? t.totals.itemCount : 0;
  return i.jsx('div', {
    className: 'v-section',
    'data-part': 'root',
    style: { paddingBlock: 8, display: 'flex', justifyContent: 'flex-end' },
    children: i.jsx(Ya, {
      asChild: !0,
      children: i.jsxs('button', {
        type: 'button',
        className: e.variant === 'pill' ? 'v-cart-pill' : 'v-link-btn',
        'data-part': 'trigger',
        children: [e.label, ' ', i.jsx('span', { className: 'v-cart-count', children: n })],
      }),
    }),
  });
}
function O0({ settings: e }) {
  const { params: t } = fl(),
    n = e.product || t.slug || '',
    { product: r, loading: l, error: a, refetch: o } = Hs(n),
    { store: s, status: u } = X(),
    { config: c } = J(),
    m = yn(),
    [d, f] = x.useState({}),
    [v, k] = x.useState(1),
    [w, j] = x.useState(null),
    [h, p] = x.useState(!1),
    g = (s == null ? void 0 : s.currency) ?? 'BRL',
    y = Gn(c).catalog,
    S = s0('media', 'media');
  x.useEffect(() => {
    r && s && !e.product && (document.title = `${r.name} · ${s.name}`);
  }, [r, s, e.product]);
  const N = x.useMemo(() => (r == null ? void 0 : r.modifierGroups) ?? [], [r]),
    _ = N.filter((b) => {
      var re;
      return (
        b.required &&
        (((re = d[b.id]) == null ? void 0 : re.length) ?? 0) < Math.max(1, b.minSelect)
      );
    }),
    P = Object.fromEntries(_.map((b) => [b.id, w ? 'Escolha uma opção' : '']).filter(([, b]) => b));
  if (!n) return null;
  if (l && !r)
    return i.jsx('section', {
      className: 'v-section',
      'aria-busy': 'true',
      'aria-label': 'Carregando produto',
      'data-part': 'root',
      children: i.jsxs('div', {
        className: 'v-pp',
        'data-variant': e.variant,
        children: [i.jsx('div', { className: 'v-pp-media' }), i.jsx('div', {})],
      }),
    });
  if (!r)
    return i.jsx('section', {
      className: 'v-section',
      'data-part': 'root',
      children: i.jsxs('div', {
        className: 'v-panel v-empty',
        role: a ? 'alert' : void 0,
        children: [
          i.jsx('h1', {
            className: 'v-panel-title',
            children:
              a && a.code !== 'PRODUCT_NOT_FOUND'
                ? 'Não foi possível carregar o produto.'
                : 'Produto não encontrado.',
          }),
          a && a.code !== 'PRODUCT_NOT_FOUND'
            ? i.jsx('button', {
                type: 'button',
                className: 'v-btn v-btn-accent',
                onClick: o,
                children: 'Tentar novamente',
              })
            : i.jsx(ct, { href: y, className: 'v-btn v-btn-accent', children: e.backLabel }),
        ],
      }),
    });
  const I = r.status !== 'active',
    T = e.product ? 'h2' : 'h1';
  return i.jsxs('section', {
    className: 'v-section',
    'data-part': 'root',
    children: [
      e.product
        ? null
        : i.jsxs(ct, {
            href: y,
            className: 'v-back',
            'data-part': 'back',
            children: ['← ', e.backLabel],
          }),
      i.jsxs('article', {
        className: 'v-pp',
        'data-variant': e.variant,
        'data-status': r.status,
        children: [
          i.jsxs('div', {
            className: 'v-pp-media',
            'data-part': 'media',
            children: [
              i.jsx(Ue, { name: 'media', only: ['media'], className: 'v-pp-media-custom' }),
              i.jsx(Ue, { name: 'media', only: ['badge'], className: 'v-pp-media-badges' }),
              S
                ? null
                : r.imageUrl
                  ? i.jsx('img', {
                      src: r.imageUrl,
                      alt: r.name,
                      fetchPriority: 'high',
                      decoding: 'async',
                    })
                  : i.jsx('span', {
                      className: 'v-card-initial',
                      'aria-hidden': 'true',
                      'data-figure': r.figureVariant,
                      children: r.name.slice(0, 1).toUpperCase(),
                    }),
            ],
          }),
          i.jsxs('div', {
            className: 'v-pp-info',
            'data-part': 'info',
            children: [
              i.jsx(T, { className: 'v-page-title', 'data-part': 'name', children: r.name }),
              i.jsx('p', {
                className: 'v-pp-price v-num',
                'data-part': 'price',
                children: se(r.basePriceCents, g),
              }),
              i.jsx(Ue, { name: 'after-price', className: 'v-pp-area' }),
              e.showDescription && r.description
                ? i.jsx('p', {
                    className: 'v-pp-desc',
                    'data-part': 'description',
                    children: r.description,
                  })
                : null,
              N.length > 0
                ? i.jsx(B, {
                    name: 'catalog.ModifierPicker',
                    groups: N,
                    value: d,
                    currency: g,
                    errors: P,
                    onChange: (b, re) => {
                      (j(null), f((Z) => ({ ...Z, [b]: re })));
                    },
                  })
                : null,
              I
                ? i.jsx('p', {
                    className: 'v-alert',
                    role: 'status',
                    'data-part': 'sold-out',
                    children: e.soldOutText,
                  })
                : i.jsxs('div', {
                    className: 'v-pp-buy',
                    'data-part': 'buy',
                    children: [
                      i.jsxs('span', {
                        className: 'v-qty',
                        role: 'group',
                        'aria-label': 'Quantidade',
                        children: [
                          i.jsx('button', {
                            type: 'button',
                            'aria-label': 'Diminuir quantidade',
                            disabled: v <= 1,
                            onClick: () => k((b) => Math.max(1, b - 1)),
                            children: '−',
                          }),
                          i.jsx('output', { 'aria-live': 'polite', children: v }),
                          i.jsx('button', {
                            type: 'button',
                            'aria-label': 'Aumentar quantidade',
                            disabled: v >= 99,
                            onClick: () => k((b) => Math.min(99, b + 1)),
                            children: '+',
                          }),
                        ],
                      }),
                      i.jsx(c0, {
                        product: r,
                        qty: v,
                        modifierIds: Object.values(d).flat(),
                        asChild: !0,
                        onAdded: () => {
                          (p(!0), e.afterAdd === 'cart' && m(Gn(c).cart));
                        },
                        onError: (b) =>
                          j(
                            b.code === 'MODIFIER_REQUIRED'
                              ? 'Escolha as opções obrigatórias antes de adicionar.'
                              : `Não foi possível adicionar (${b.message}).`,
                          ),
                        children: i.jsxs('button', {
                          type: 'button',
                          className: 'v-btn v-btn-accent',
                          disabled: _.length > 0 || u === 'paused',
                          'data-part': 'add',
                          children: [e.addLabel, ' · ', se(r.basePriceCents * v, g)],
                        }),
                      }),
                    ],
                  }),
              _.length > 0 && !I
                ? i.jsxs('p', {
                    className: 'v-muted',
                    role: 'note',
                    'data-part': 'missing',
                    children: ['Falta escolher: ', _.map((b) => b.name).join(', '), '.'],
                  })
                : null,
              h && e.afterAdd === 'stay'
                ? i.jsx('p', {
                    className: 'v-note',
                    role: 'status',
                    children: 'Adicionado à sacola.',
                  })
                : null,
              w ? i.jsx('p', { className: 'v-alert', role: 'alert', children: w }) : null,
              i.jsx(Ue, { name: 'after-cta', className: 'v-pp-area' }),
            ],
          }),
        ],
      }),
    ],
  });
}
const Po = (e) => e.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
function Cp({ products: e, variant: t, currency: n }) {
  const { config: r } = J();
  return i.jsx('ol', {
    className: 'v-grid',
    'data-variant': t,
    'data-part': 'grid',
    children: e.map((l) =>
      i.jsx(
        'li',
        {
          'data-part': 'item',
          children: i.jsx(B, {
            name: 'catalog.ProductCard',
            product: l,
            currency: n,
            href: ap(r, l.slug),
            link: (a) =>
              i.jsx(qs, {
                product: l,
                asChild: !0,
                children: i.jsx('a', {
                  'aria-label':
                    l.status === 'active'
                      ? `${l.name}, ${se(l.basePriceCents, n)}`
                      : `${l.name}, esgotado`,
                  children: a,
                }),
              }),
          }),
        },
        l.id,
      ),
    ),
  });
}
function I0({ settings: e }) {
  const { categories: t, loading: n, error: r, refetch: l } = ul(),
    { store: a } = X(),
    { page: o } = fl(),
    [s, u] = x.useState('all'),
    [c, m] = x.useState(''),
    d = (a == null ? void 0 : a.currency) ?? 'BRL',
    f = t.filter((w) => w.products.some((j) => j.status !== 'archived')),
    v = Po(c.trim()),
    k = f
      .filter((w) => s === 'all' || w.id === s)
      .map((w) => ({
        ...w,
        products: w.products.filter(
          (j) =>
            j.status !== 'archived' &&
            (!v || Po(j.name).includes(v) || Po(j.description ?? '').includes(v)),
        ),
      }))
      .filter((w) => w.products.length > 0);
  return i.jsxs('section', {
    className: 'v-section',
    'data-part': 'root',
    id: 'cardapio',
    children: [
      i.jsx(Js, {
        eyebrow: e.eyebrow,
        title: e.title,
        intro: e.intro,
        as: o === 'catalog' ? 'h1' : 'h2',
      }),
      i.jsx(Ue, { name: 'before-grid' }),
      e.showSearch
        ? i.jsxs('form', {
            role: 'search',
            className: 'v-search',
            'data-part': 'search',
            onSubmit: (w) => w.preventDefault(),
            children: [
              i.jsx('label', {
                className: 'v-label',
                htmlFor: 'v-catalog-search',
                children: e.searchLabel,
              }),
              i.jsx('input', {
                id: 'v-catalog-search',
                type: 'search',
                className: 'v-input',
                value: c,
                maxLength: 80,
                onChange: (w) => m(w.target.value),
              }),
            ],
          })
        : null,
      e.showCategoryTabs && f.length > 1
        ? i.jsxs('nav', {
            className: 'v-tabs',
            'aria-label': 'Categorias',
            'data-part': 'tabs',
            children: [
              i.jsx('button', {
                type: 'button',
                className: 'v-tab',
                'aria-pressed': s === 'all',
                onClick: () => u('all'),
                children: e.allLabel,
              }),
              f.map((w) =>
                i.jsx(
                  'button',
                  {
                    type: 'button',
                    className: 'v-tab',
                    'aria-pressed': s === w.id,
                    onClick: () => u(w.id),
                    children: w.name,
                  },
                  w.id,
                ),
              ),
            ],
          })
        : null,
      n && t.length === 0
        ? i.jsx('div', {
            className: 'v-grid',
            'aria-busy': 'true',
            'aria-label': 'Carregando cardápio',
            children: Array.from({ length: 4 }, (w, j) =>
              i.jsx('div', { className: 'v-card-media' }, j),
            ),
          })
        : r && t.length === 0
          ? i.jsx(B, {
              name: 'system.ErrorFallback',
              error: { code: r.code, message: 'O cardápio não carregou.' },
              retry: l,
            })
          : k.length === 0
            ? i.jsx('p', {
                className: 'v-muted',
                'data-part': 'empty',
                children: v ? `Nada encontrado para “${c.trim()}”.` : e.emptyText,
              })
            : k.map((w) =>
                i.jsxs(
                  'div',
                  {
                    'data-part': 'category',
                    children: [
                      k.length > 1 || s === 'all'
                        ? i.jsx('h3', { className: 'v-cat-title', children: w.name })
                        : null,
                      i.jsx(Cp, { products: w.products, variant: e.variant, currency: d }),
                    ],
                  },
                  w.id,
                ),
              ),
    ],
  });
}
function A0({ settings: e }) {
  var o;
  const { categories: t, loading: n } = ul(),
    { store: r } = X(),
    a = (
      e.category
        ? (((o = t.find((s) => s.slug === e.category)) == null ? void 0 : o.products) ?? [])
        : t.flatMap((s) => s.products)
    )
      .filter((s) => s.status === 'active')
      .slice(0, e.limit);
  return !n && a.length === 0
    ? null
    : i.jsxs('section', {
        className: 'v-section',
        'data-part': 'root',
        children: [
          i.jsx(Js, { eyebrow: e.eyebrow, title: e.title, intro: e.intro }),
          n && a.length === 0
            ? i.jsx('div', {
                className: 'v-grid',
                'aria-busy': 'true',
                'aria-label': 'Carregando produtos',
                children: Array.from({ length: e.limit }, (s, u) =>
                  i.jsx('div', { className: 'v-card-media' }, u),
                ),
              })
            : i.jsx(Cp, {
                products: a,
                variant: e.variant,
                currency: (r == null ? void 0 : r.currency) ?? 'BRL',
              }),
          e.ctaLabel && e.ctaHref
            ? i.jsx('p', {
                style: { marginTop: 24 },
                children: i.jsx(ct, {
                  href: e.ctaHref,
                  className: 'v-btn v-btn-ghost',
                  'data-part': 'cta',
                  children: e.ctaLabel,
                }),
              })
            : null,
        ],
      });
}
function D0({ settings: e }) {
  const { store: t } = X();
  return t
    ? i.jsx('section', {
        className: 'v-section',
        'data-part': 'root',
        'data-variant': e.variant,
        children: i.jsxs('div', {
          className: e.variant === 'card' ? 'v-panel v-status-card' : 'v-status-card',
          children: [
            i.jsxs('div', {
              style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
              children: [
                i.jsx('h2', {
                  className: 'v-section-title',
                  style: { margin: 0 },
                  children: e.title,
                }),
                i.jsx(Ys, {}),
              ],
            }),
            e.showAddress && t.address
              ? i.jsxs('p', {
                  className: 'v-muted',
                  'data-part': 'address',
                  style: { margin: 0 },
                  children: [t.address, t.city ? `, ${t.city}` : ''],
                })
              : null,
            e.showHours
              ? i.jsx(B, { name: 'store.HoursTable', hours: t.hours, status: t.status })
              : null,
          ],
        }),
      })
    : null;
}
function z0({ settings: e }) {
  const { page: t } = fl(),
    n = (e.body ?? '').split(/\n{2,}/).filter(Boolean);
  return !e.title && n.length === 0
    ? null
    : i.jsxs('section', {
        className: 'v-section v-rich',
        'data-part': 'root',
        children: [
          i.jsx(Js, {
            eyebrow: e.eyebrow,
            title: e.title,
            as: t.startsWith('page:') ? 'h1' : 'h2',
          }),
          n.map((r, l) => i.jsx('p', { children: r }, l)),
        ],
      });
}
const Pe = (e, t) => ({ schema: e, Component: t, source: 'sdk' }),
  B0 = [
    Pe(g0, T0),
    Pe(v0, L0),
    Pe(y0, R0),
    Pe(x0, b0),
    Pe(w0, M0),
    Pe(k0, O0),
    Pe(j0, I0),
    Pe(S0, A0),
    Pe(N0, D0),
    Pe(C0, z0),
    Pe(E0, p0),
    Pe(_0, h0),
    Pe(P0, m0),
  ];
function F0({ item: e, currency: t }) {
  const { mutations: n } = pt(),
    [r, l] = x.useState(!1),
    a = async (o) => {
      l(!0);
      try {
        await o();
      } catch (s) {
        Ha(s);
      } finally {
        l(!1);
      }
    };
  return i.jsx(B, {
    name: 'cart.LineItem',
    item: e,
    currency: t,
    pending: r,
    onQty: (o) => void a(() => (o <= 0 ? n.remove(e.id) : n.updateQty(e.id, Math.min(o, 99)))),
    onRemove: () => void a(() => n.remove(e.id)),
  });
}
function $0() {
  const { cart: e, loading: t } = pt(),
    { store: n } = X(),
    { config: r } = J(),
    l = yn(),
    a = (n == null ? void 0 : n.currency) ?? 'BRL',
    o = () => l(Gn(r).catalog),
    s = (e == null ? void 0 : e.status) === 'open' && e.items.length > 0;
  return i.jsx('main', {
    id: 'main',
    className: 'v-page',
    'data-vendua-page': 'cart',
    children:
      t && !e
        ? i.jsx('div', {
            'aria-busy': 'true',
            'aria-label': 'Carregando sacola',
            className: 'v-panel',
          })
        : s
          ? i.jsx(B, {
              name: 'cart.Drawer',
              cart: e,
              currency: a,
              presentation: 'page',
              onClose: o,
              lines: e.items.map((u) => i.jsx(F0, { item: u, currency: a }, u.id)),
              summary: i.jsx(B, { name: 'checkout.Summary', cart: e, currency: a }),
              checkout: i.jsx(d0, {
                asChild: !0,
                children: i.jsx('button', {
                  type: 'button',
                  className: 'v-btn v-btn-accent v-btn-block',
                  children: 'Ir para o pagamento',
                }),
              }),
            })
          : i.jsx(B, { name: 'checkout.EmptyCart', onBrowse: o }),
  });
}
const xr = ['dados', 'entrega', 'pagamento'],
  U0 = { dados: 'Seus dados', entrega: 'Entrega', pagamento: 'Pagamento' },
  V0 = [
    { id: 'pix', label: 'Pix' },
    { id: 'card_on_delivery', label: 'Cartão na entrega' },
    { id: 'cash', label: 'Dinheiro' },
  ];
function H0(e, t, n) {
  const r = {};
  if (e === 'dados') {
    t.name.trim().length < 2 && (r.name = 'Informe seu nome.');
    const l = t.phone.replace(/\D/g, '');
    (l.length < 10 || l.length > 13) && (r.phone = 'Informe um WhatsApp com DDD.');
  }
  return (
    e === 'entrega' &&
      n === 'delivery' &&
      (t.neighborhood.trim() || (r.neighborhood = 'Informe o bairro.'),
      t.street.trim() || (r.street = 'Informe a rua.'),
      t.number.trim() || (r.number = 'Informe o número.')),
    r
  );
}
function W0() {
  const { cart: e, loading: t, mutations: n } = pt(),
    { store: r } = X(),
    { zones: l } = Ay(),
    { submit: a, pending: o, error: s, reset: u } = zy(),
    { customer: c, remember: m, forget: d } = Fy(),
    { config: f } = J(),
    v = yn(),
    k = Gn(f),
    w = (r == null ? void 0 : r.currency) ?? 'BRL',
    [j, h] = x.useState('dados'),
    [p, g] = x.useState(new Set()),
    [y, S] = x.useState(() => ({
      name: (c == null ? void 0 : c.name) ?? '',
      phone: (c == null ? void 0 : c.phone) ?? '',
      street: (c == null ? void 0 : c.address.street) ?? '',
      number: (c == null ? void 0 : c.address.number) ?? '',
      neighborhood: (c == null ? void 0 : c.address.neighborhood) ?? '',
      complement: (c == null ? void 0 : c.address.complement) ?? '',
      remember: !0,
    })),
    N = (r == null ? void 0 : r.deliveryEnabled) !== !1,
    _ = (r == null ? void 0 : r.pickupEnabled) !== !1,
    [P, I] = x.useState(N ? 'delivery' : 'pickup'),
    [T, b] = x.useState('pix'),
    [re, Z] = x.useState({}),
    [sr, ml] = x.useState(null),
    [ur, xn] = x.useState(!1),
    L = x.useRef(!1),
    M = x.useRef(Date.now());
  x.useEffect(() => {
    (Qe('checkout_step', { step: j, duration_ms: Date.now() - M.current }),
      (M.current = Date.now()));
  }, [j]);
  const O = x.useMemo(() => l.flatMap((le) => le.neighborhoods), [l]),
    $ = l.length ? Math.min(...l.map((le) => le.feeCents)) : null,
    ee = [
      {
        mode: 'delivery',
        label: 'Entrega',
        ...($ !== null ? { detail: $ > 0 ? `a partir de ${se($, w)}` : 'grátis' } : {}),
        disabled: !N,
      },
      {
        mode: 'pickup',
        label: 'Retirada',
        detail: (r == null ? void 0 : r.address) ?? 'na loja',
        disabled: !_,
      },
    ];
  if (t && !e)
    return i.jsx('main', {
      id: 'main',
      className: 'v-page',
      'data-vendua-page': 'checkout',
      'aria-busy': 'true',
      'aria-label': 'Carregando checkout',
    });
  if (!e || e.status !== 'open' || e.items.length === 0)
    return i.jsx('main', {
      id: 'main',
      className: 'v-page',
      'data-vendua-page': 'checkout',
      children: i.jsx(B, { name: 'checkout.EmptyCart', onBrowse: () => v(k.catalog) }),
    });
  const Zt = (le) => {
      (S((gt) => ({ ...gt, ...le })),
        Z((gt) => {
          const au = { ...gt };
          for (const Gp of Object.keys(le)) delete au[Gp];
          return au;
        }));
    },
    mt = async () => {
      const le = H0(j, y, P);
      if ((Z(le), !Object.keys(le).length)) {
        if (j === 'entrega') {
          (xn(!0), ml(null));
          try {
            await n.setDelivery(
              P === 'pickup' ? { mode: P } : { mode: P, neighborhood: y.neighborhood.trim() },
            );
          } catch (gt) {
            ml(Mi(ip(gt)).title);
          } finally {
            xn(!1);
          }
        }
        (g((gt) => new Set(gt).add(j)), h(xr[xr.indexOf(j) + 1] ?? j));
      }
    },
    cr = async () => {
      if (!(L.current || o)) {
        ((L.current = !0), u());
        try {
          const le = [y.street.trim(), y.number.trim(), y.complement.trim()]
              .filter(Boolean)
              .join(', '),
            gt = await a({
              customer: { name: y.name.trim(), phone: y.phone.replace(/\D/g, '') },
              delivery:
                P === 'pickup'
                  ? { mode: P }
                  : { mode: P, neighborhood: y.neighborhood.trim(), address: le },
              payment: { method: T },
            });
          (y.remember
            ? m({
                name: y.name,
                phone: y.phone,
                address: {
                  street: y.street,
                  number: y.number,
                  neighborhood: y.neighborhood,
                  complement: y.complement,
                },
              })
            : d(),
            v(`${k.order.replace(':id', gt.id)}?novo=1`));
        } catch {
        } finally {
          L.current = !1;
        }
      }
    },
    De = s ? Mi(s.code) : null,
    wn = xr.map((le) => ({ id: le, label: U0[le], done: p.has(le) }));
  return i.jsxs('main', {
    id: 'main',
    className: 'v-page',
    'data-vendua-page': 'checkout',
    children: [
      i.jsx('h1', { className: 'v-page-title', children: 'Finalizar pedido' }),
      i.jsxs('div', {
        className: 'v-checkout-grid',
        children: [
          i.jsx(B, {
            name: 'checkout.Layout',
            steps: wn,
            current: j,
            onStep: (le) => h(le),
            children: i.jsxs('form', {
              noValidate: !0,
              'data-step': j,
              onSubmit: (le) => {
                (le.preventDefault(), j === 'pagamento' ? cr() : mt());
              },
              children: [
                j === 'dados'
                  ? i.jsx(B, {
                      name: 'checkout.AddressForm',
                      part: 'customer',
                      value: y,
                      onChange: Zt,
                      errors: re,
                      neighborhoods: O,
                    })
                  : null,
                j === 'entrega'
                  ? i.jsxs(i.Fragment, {
                      children: [
                        i.jsx(B, {
                          name: 'checkout.DeliveryOptions',
                          options: ee,
                          selected: P,
                          onSelect: I,
                        }),
                        P === 'delivery'
                          ? i.jsx(B, {
                              name: 'checkout.AddressForm',
                              part: 'address',
                              value: y,
                              onChange: Zt,
                              errors: re,
                              neighborhoods: O,
                            })
                          : null,
                      ],
                    })
                  : null,
                j === 'pagamento'
                  ? i.jsxs(i.Fragment, {
                      children: [
                        i.jsx(B, {
                          name: 'checkout.PaymentMethods',
                          methods: V0,
                          selected: T,
                          onSelect: b,
                        }),
                        sr
                          ? i.jsx('p', {
                              className: 'v-alert',
                              role: 'alert',
                              'data-part': 'delivery-issue',
                              children: sr,
                            })
                          : null,
                        De
                          ? i.jsxs('div', {
                              className: 'v-alert',
                              role: 'alert',
                              'data-vendua': 'checkout-error',
                              'data-code': s == null ? void 0 : s.code,
                              children: [
                                i.jsx('strong', { children: De.title }),
                                De.body ? i.jsxs('span', { children: [' ', De.body] }) : null,
                              ],
                            })
                          : null,
                      ],
                    })
                  : null,
                i.jsxs('div', {
                  style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 },
                  children: [
                    j !== 'dados'
                      ? i.jsx('button', {
                          type: 'button',
                          className: 'v-btn v-btn-ghost',
                          onClick: () => h(xr[xr.indexOf(j) - 1] ?? 'dados'),
                          children: 'Voltar',
                        })
                      : null,
                    j === 'pagamento'
                      ? i.jsx('button', {
                          type: 'submit',
                          className: 'v-btn v-btn-accent',
                          disabled: o,
                          'aria-busy': o || void 0,
                          children: o
                            ? 'Enviando…'
                            : `Confirmar pedido · ${se(e.totals.totalCents, w)}`,
                        })
                      : i.jsx('button', {
                          type: 'submit',
                          className: 'v-btn v-btn-accent',
                          disabled: ur,
                          children: 'Continuar',
                        }),
                  ],
                }),
              ],
            }),
          }),
          i.jsx(B, { name: 'checkout.Summary', cart: e, currency: w }),
        ],
      }),
    ],
  });
}
const Q0 = new Set(['delivered', 'cancelled', 'refunded']);
function K0() {
  const { id: e = '' } = ep(),
    { search: t } = nt(),
    { order: n, loading: r, error: l, refetch: a } = Dy(e),
    { store: o } = X(),
    s = (o == null ? void 0 : o.currency) ?? 'BRL',
    u = new URLSearchParams(t).has('novo');
  return (
    x.useEffect(() => {
      if (!n || Q0.has(n.state)) return;
      const c = setInterval(a, 2e4);
      return () => clearInterval(c);
    }, [n, a]),
    i.jsx('main', {
      id: 'main',
      className: 'v-page',
      'data-vendua-page': 'order',
      children:
        r && !n
          ? i.jsx('div', {
              className: 'v-panel',
              'aria-busy': 'true',
              'aria-label': 'Carregando pedido',
            })
          : n
            ? i.jsxs(i.Fragment, {
                children: [
                  u ? i.jsx(B, { name: 'checkout.SuccessPage', order: n, currency: s }) : null,
                  i.jsx(B, {
                    name: 'order.StatusPage',
                    order: n,
                    currency: s,
                    timeline: i.jsx(B, { name: 'order.Timeline', events: n.timeline }),
                  }),
                  i.jsx('p', {
                    style: { marginTop: 24 },
                    children: i.jsx(ct, {
                      href: ot.orders,
                      className: 'v-btn v-btn-ghost',
                      children: 'Meus pedidos',
                    }),
                  }),
                ],
              })
            : i.jsx(B, {
                name: 'system.ErrorFallback',
                error: {
                  code: (l == null ? void 0 : l.code) ?? 'ORDER_NOT_FOUND',
                  message:
                    (l == null ? void 0 : l.code) === 'ORDER_NOT_FOUND' ||
                    (l == null ? void 0 : l.status) === 400
                      ? 'Pedido não encontrado neste aparelho.'
                      : 'O pedido não carregou.',
                },
                retry: a,
              }),
    })
  );
}
function q0() {
  const { orders: e, loading: t } = Uy(),
    { store: n } = X(),
    r = (n == null ? void 0 : n.currency) ?? 'BRL';
  return i.jsxs('main', {
    id: 'main',
    className: 'v-page',
    'data-vendua-page': 'orders',
    children: [
      i.jsx('h1', { className: 'v-page-title', children: 'Meus pedidos' }),
      i.jsx('p', { className: 'v-muted', children: 'Pedidos feitos neste aparelho.' }),
      t && e.length === 0
        ? i.jsx('div', {
            className: 'v-panel',
            'aria-busy': 'true',
            'aria-label': 'Carregando pedidos',
          })
        : e.length === 0
          ? i.jsxs('div', {
              className: 'v-panel v-empty',
              'data-part': 'empty',
              children: [
                i.jsx('p', {
                  className: 'v-panel-title',
                  children: 'Nenhum pedido por aqui ainda.',
                }),
                i.jsx(ct, {
                  href: '/',
                  className: 'v-btn v-btn-accent',
                  children: 'Fazer um pedido',
                }),
              ],
            })
          : i.jsx('ol', {
              className: 'v-order-list',
              'data-part': 'list',
              children: e.map((l) =>
                i.jsx(
                  'li',
                  {
                    children: i.jsxs(ct, {
                      href: ot.order.replace(':id', l.id),
                      'data-state': l.state,
                      children: [
                        i.jsxs('span', {
                          children: [
                            i.jsxs('strong', { children: ['Pedido #', l.number] }),
                            ' ',
                            i.jsx('span', {
                              className: 'v-muted',
                              children: new Date(l.placedAt).toLocaleDateString('pt-BR'),
                            }),
                          ],
                        }),
                        i.jsxs('span', {
                          children: [
                            Qa[l.state] ?? l.state,
                            ' ·',
                            ' ',
                            i.jsx('span', { className: 'v-num', children: se(l.totalCents, r) }),
                          ],
                        }),
                      ],
                    }),
                  },
                  l.id,
                ),
              ),
            }),
    ],
  });
}
function Y0() {
  const { pathname: e } = nt();
  return (
    x.useEffect(() => {
      Qe('page_view', {
        path: e,
        referrer: document.referrer ? new URL(document.referrer).host : '',
      });
    }, [e]),
    null
  );
}
function J0() {
  const e = kp('layout');
  return e
    ? i.jsx(xp, { value: { page: 'layout', params: {} }, children: i.jsx(Sp, { template: e }) })
    : null;
}
function Ol({ page: e }) {
  const t = kp(e),
    n = ep(),
    { store: r } = X();
  if (
    (x.useEffect(() => {
      r && e !== 'product' && (document.title = r.name);
    }, [r, e]),
    !t)
  )
    return i.jsx(Ep, {});
  const l = i.jsx(xp, {
    value: { page: e, params: n },
    children: i.jsx(Sp, { template: t, only: (a) => a.type !== mp }),
  });
  return i.jsx('main', { id: 'main', 'data-page': e, children: l });
}
function Ep() {
  const { pathname: e } = nt();
  return i.jsx(B, { name: 'system.NotFound', path: e, homeHref: '/' });
}
function G0() {
  const { config: e } = J(),
    t = Gn(e),
    n = wp(),
    r = x.useMemo(
      () =>
        Object.keys(n)
          .map((a) => qy(a))
          .filter((a) => !!a),
      [n],
    ),
    l = new Set([t.home, t.catalog, ...Object.values(ot)]);
  return i.jsxs(l0, {
    sdk: B0,
    children: [
      i.jsx(Y0, {}),
      i.jsxs(jv, {
        children: [
          Object.entries(e.redirects ?? {}).map(([a, o]) =>
            i.jsx(ze, { path: a, element: i.jsx(xv, { to: o, replace: !0 }) }, `r:${a}`),
          ),
          i.jsxs(ze, {
            element: i.jsx(J0, {}),
            children: [
              i.jsx(ze, { index: !0, element: i.jsx(Ol, { page: 'home' }) }),
              i.jsx(ze, { path: t.catalog, element: i.jsx(Ol, { page: 'catalog' }) }),
              i.jsx(ze, { path: t.product, element: i.jsx(Ol, { page: 'product' }) }),
              i.jsx(ze, { path: ot.cart, element: i.jsx($0, {}) }),
              i.jsx(ze, { path: ot.checkout, element: i.jsx(W0, {}) }),
              i.jsx(ze, { path: ot.order, element: i.jsx(K0, {}) }),
              i.jsx(ze, { path: ot.orders, element: i.jsx(q0, {}) }),
              r
                .filter((a) => !l.has(`/${a}`))
                .map((a) =>
                  i.jsx(ze, { path: `/${a}`, element: i.jsx(Ol, { page: `page:${a}` }) }, `p:${a}`),
                ),
              i.jsx(ze, { path: '*', element: i.jsx(Ep, {}) }),
            ],
          }),
        ],
      }),
    ],
  });
}
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const X0 = (e) => e.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase(),
  _p = (...e) =>
    e
      .filter((t, n, r) => !!t && t.trim() !== '' && r.indexOf(t) === n)
      .join(' ')
      .trim();
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ var Z0 = {
  xmlns: 'http://www.w3.org/2000/svg',
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const e1 = x.forwardRef(
  (
    {
      color: e = 'currentColor',
      size: t = 24,
      strokeWidth: n = 2,
      absoluteStrokeWidth: r,
      className: l = '',
      children: a,
      iconNode: o,
      ...s
    },
    u,
  ) =>
    x.createElement(
      'svg',
      {
        ref: u,
        ...Z0,
        width: t,
        height: t,
        stroke: e,
        strokeWidth: r ? (Number(n) * 24) / Number(t) : n,
        className: _p('lucide', l),
        ...s,
      },
      [...o.map(([c, m]) => x.createElement(c, m)), ...(Array.isArray(a) ? a : [a])],
    ),
);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const pe = (e, t) => {
  const n = x.forwardRef(({ className: r, ...l }, a) =>
    x.createElement(e1, { ref: a, iconNode: t, className: _p(`lucide-${X0(e)}`, r), ...l }),
  );
  return ((n.displayName = `${e}`), n);
};
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const t1 = pe('ArrowLeft', [
  ['path', { d: 'm12 19-7-7 7-7', key: '1l729n' }],
  ['path', { d: 'M19 12H5', key: 'x3x0zl' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const Pc = pe('ArrowUpRight', [
  ['path', { d: 'M7 7h10v10', key: '1tivn9' }],
  ['path', { d: 'M7 17 17 7', key: '1vkiza' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const n1 = pe('Download', [
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', key: 'ih7n3h' }],
  ['polyline', { points: '7 10 12 15 17 10', key: '2ggqvy' }],
  ['line', { x1: '12', x2: '12', y1: '15', y2: '3', key: '1vk2je' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const r1 = pe('Heart', [
  [
    'path',
    {
      d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
      key: 'c3ymky',
    },
  ],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const Pp = pe('Instagram', [
  ['rect', { width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5', key: '2e1cvw' }],
  ['path', { d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z', key: '9exkf1' }],
  ['line', { x1: '17.5', x2: '17.51', y1: '6.5', y2: '6.5', key: 'r4j83e' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const Tp = pe('MessageCircle', [
  ['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z', key: 'vv11sd' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const l1 = pe('Printer', [
  [
    'path',
    {
      d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2',
      key: '143wyd',
    },
  ],
  ['path', { d: 'M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6', key: '1itne7' }],
  ['rect', { x: '6', y: '14', width: '12', height: '8', rx: '1', key: '1ue0tg' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const a1 = pe('QrCode', [
  ['rect', { width: '5', height: '5', x: '3', y: '3', rx: '1', key: '1tu5fj' }],
  ['rect', { width: '5', height: '5', x: '16', y: '3', rx: '1', key: '1v8r4q' }],
  ['rect', { width: '5', height: '5', x: '3', y: '16', rx: '1', key: '1x03jg' }],
  ['path', { d: 'M21 16h-3a2 2 0 0 0-2 2v3', key: '177gqh' }],
  ['path', { d: 'M21 21v.01', key: 'ents32' }],
  ['path', { d: 'M12 7v3a2 2 0 0 1-2 2H7', key: '8crl2c' }],
  ['path', { d: 'M3 12h.01', key: 'nlz23k' }],
  ['path', { d: 'M12 3h.01', key: 'n36tog' }],
  ['path', { d: 'M12 16v.01', key: '133mhm' }],
  ['path', { d: 'M16 12h1', key: '1slzba' }],
  ['path', { d: 'M21 12v.01', key: '1lwtk9' }],
  ['path', { d: 'M12 21v-1', key: '1880an' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const o1 = pe('RefreshCw', [
  ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', key: 'v9h5vc' }],
  ['path', { d: 'M21 3v5h-5', key: '1q7to0' }],
  ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', key: '3uifl3' }],
  ['path', { d: 'M8 16H3v5', key: '1cv678' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const i1 = pe('SearchX', [
  ['path', { d: 'm13.5 8.5-5 5', key: '1cs55j' }],
  ['path', { d: 'm8.5 8.5 5 5', key: 'a8mexj' }],
  ['circle', { cx: '11', cy: '11', r: '8', key: '4ej97u' }],
  ['path', { d: 'm21 21-4.3-4.3', key: '1qie3q' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const s1 = pe('Search', [
  ['circle', { cx: '11', cy: '11', r: '8', key: '4ej97u' }],
  ['path', { d: 'm21 21-4.3-4.3', key: '1qie3q' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const u1 = pe('ShieldCheck', [
  [
    'path',
    {
      d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      key: 'oel41y',
    },
  ],
  ['path', { d: 'm9 12 2 2 4-4', key: 'dzmm74' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const Gs = pe('ShoppingBag', [
  ['path', { d: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', key: 'hou9p0' }],
  ['path', { d: 'M3 6h18', key: 'd0wm0j' }],
  ['path', { d: 'M16 10a4 4 0 0 1-8 0', key: '1ltviw' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const Lp = pe('Snowflake', [
  ['line', { x1: '2', x2: '22', y1: '12', y2: '12', key: '1dnqot' }],
  ['line', { x1: '12', x2: '12', y1: '2', y2: '22', key: '7eqyqh' }],
  ['path', { d: 'm20 16-4-4 4-4', key: 'rquw4f' }],
  ['path', { d: 'm4 8 4 4-4 4', key: '12s3z9' }],
  ['path', { d: 'm16 4-4 4-4-4', key: '1tumq1' }],
  ['path', { d: 'm8 20 4-4 4 4', key: '9p200w' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const Rp = pe('Truck', [
  ['path', { d: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2', key: 'wrbu53' }],
  ['path', { d: 'M15 18H9', key: '1lyqi6' }],
  [
    'path',
    {
      d: 'M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14',
      key: 'lysw3i',
    },
  ],
  ['circle', { cx: '17', cy: '18', r: '2', key: '332jqn' }],
  ['circle', { cx: '7', cy: '18', r: '2', key: '19iecd' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const c1 = pe('Utensils', [
  ['path', { d: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', key: 'cjf0a3' }],
  ['path', { d: 'M7 2v20', key: '1473qp' }],
  ['path', { d: 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7', key: 'j28e5' }],
]);
/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const d1 = pe('X', [
  ['path', { d: 'M18 6 6 18', key: '1bl5f8' }],
  ['path', { d: 'm6 6 12 12', key: 'd8bk6v' }],
]);
function Xs({ variant: e = 'default', className: t, title: n = 'Doce artesanal' }) {
  return e === 'alt'
    ? i.jsxs('svg', {
        viewBox: '0 0 120 140',
        role: 'img',
        'aria-label': n,
        className: t,
        children: [
          i.jsx('ellipse', {
            cx: '60',
            cy: '128',
            rx: '30',
            ry: '6',
            fill: '#291809',
            opacity: '0.12',
          }),
          i.jsx('path', {
            d: 'M42 22 C42 14 78 14 78 22 L86 108 C86 120 34 120 34 108 Z',
            fill: '#F8ECD4',
            stroke: '#DFCAB1',
            strokeWidth: '2',
          }),
          i.jsx('rect', { x: '46', y: '26', width: '28', height: '10', rx: '5', fill: '#B45309' }),
          i.jsx('rect', {
            x: '46',
            y: '26',
            width: '28',
            height: '4',
            rx: '2',
            fill: '#D97706',
            opacity: '0.8',
          }),
          i.jsx('path', {
            d: 'M38 78 C50 70 70 86 82 76 L84 96 C84 106 36 106 36 96 Z',
            fill: '#B45309',
            opacity: '0.85',
          }),
          i.jsx('path', {
            d: 'M38 84 C50 76 70 92 82 82',
            stroke: '#7C2D12',
            strokeWidth: '2',
            fill: 'none',
            opacity: '0.5',
          }),
          i.jsx('rect', {
            x: '44',
            y: '44',
            width: '7',
            height: '52',
            rx: '3.5',
            fill: '#FFFFFF',
            opacity: '0.65',
          }),
        ],
      })
    : i.jsxs('svg', {
        viewBox: '0 0 200 160',
        role: 'img',
        'aria-label': n,
        className: t,
        children: [
          i.jsx('ellipse', {
            cx: '100',
            cy: '142',
            rx: '66',
            ry: '8',
            fill: '#291809',
            opacity: '0.14',
          }),
          i.jsx('ellipse', {
            cx: '100',
            cy: '128',
            rx: '78',
            ry: '17',
            fill: '#FFFFFF',
            stroke: '#EFE3D3',
            strokeWidth: '2',
          }),
          i.jsx('ellipse', {
            cx: '100',
            cy: '125',
            rx: '58',
            ry: '11',
            fill: 'none',
            stroke: '#EFE3D3',
            strokeWidth: '1.5',
          }),
          i.jsx('path', {
            d: 'M58 62 L64 118 C64 124 136 124 136 118 L142 62 Z',
            fill: '#F6DFA9',
            stroke: '#D9A441',
            strokeWidth: '2',
            strokeLinejoin: 'round',
          }),
          i.jsx('path', {
            d: 'M122 62 L128 116 C110 120 90 120 72 116',
            fill: 'none',
            stroke: '#D9A441',
            strokeWidth: '5',
            opacity: '0.35',
            strokeLinecap: 'round',
          }),
          i.jsx('rect', {
            x: '72',
            y: '72',
            width: '9',
            height: '38',
            rx: '4.5',
            fill: '#FFFFFF',
            opacity: '0.55',
          }),
          i.jsx('ellipse', { cx: '100', cy: '60', rx: '44', ry: '15', fill: '#7C2D12' }),
          i.jsx('ellipse', { cx: '100', cy: '57', rx: '44', ry: '14', fill: '#B45309' }),
          i.jsx('ellipse', {
            cx: '100',
            cy: '55',
            rx: '44',
            ry: '12',
            fill: '#D97706',
            opacity: '0.55',
          }),
          i.jsx('path', {
            d: 'M66 58 C66 70 62 74 62 80 C62 85 70 85 70 79 L71 60 Z',
            fill: '#B45309',
          }),
          i.jsx('path', {
            d: 'M88 62 C88 74 84 78 85 86 C86 92 94 91 94 84 L95 62 Z',
            fill: '#92400E',
          }),
          i.jsx('path', {
            d: 'M114 62 C114 72 118 76 117 83 C116 89 108 88 108 81 L109 62 Z',
            fill: '#B45309',
          }),
          i.jsx('path', {
            d: 'M132 58 C132 68 136 71 135 77 C134 82 127 81 127 75 L128 58 Z',
            fill: '#92400E',
          }),
          i.jsx('ellipse', {
            cx: '84',
            cy: '52',
            rx: '12',
            ry: '3.5',
            fill: '#FDE68A',
            opacity: '0.7',
          }),
        ],
      });
}
function Un({ className: e, style: t }) {
  return i.jsx('div', {
    className: `skeleton${e ? ` ${e}` : ''}`,
    style: t,
    'aria-hidden': 'true',
  });
}
const f1 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function tl(e) {
  return f1.format(e / 100);
}
const bp = (e) => String(e).padStart(2, '0'),
  p1 = ne({
    type: 'store:catalog-browser',
    settings: {
      eyebrow: E({ max: 60 }),
      title: E({ max: 60, default: '' }),
      lede: E({ max: 160 }),
      searchLabel: E({ max: 60, default: 'Buscar no cardápio' }),
      searchPlaceholder: E({ max: 60, default: '' }),
      allLabel: E({ max: 40, default: 'Todos' }),
      itemSingular: E({ max: 20, default: 'item' }),
      itemPlural: E({ max: 20, default: 'itens' }),
      cardCta: E({ max: 30, default: 'Ver produto' }),
      soldOutLabel: E({ max: 30, default: 'Esgotado hoje' }),
      lowStockThreshold: Ka({ min: 1, max: 20, default: 5 }),
      emptyTitle: E({ max: 80, default: 'Nada por aqui ainda' }),
      emptyText: E({ max: 200, default: '' }),
      noMatchTitle: E({ max: 80, default: 'Nada encontrado' }),
      resetLabel: E({ max: 40, default: 'Ver tudo' }),
      bagLabel: E({ max: 30, default: 'Ver sacola' }),
    },
    areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
  }),
  To = (e) => e.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
function h1({ product: e, category: t, highlighted: n, s: r }) {
  const l = e.status === 'sold_out',
    a = e.stockQuantity,
    o = !l && typeof a == 'number' && a > 0 && a <= r.lowStockThreshold,
    [s, u] = x.useState(!1);
  return i.jsx('li', {
    id: `produto-${e.slug}`,
    'data-item-card': !0,
    className: l ? 'card--soldout' : void 0,
    children: i.jsx(qs, {
      product: e,
      asChild: !0,
      children: i.jsxs('a', {
        className: 'card-link',
        'aria-label': `${e.name}, ${tl(e.basePriceCents)}${l ? `, ${r.soldOutLabel}` : ''}`,
        children: [
          i.jsx('div', {
            className: `print-frame${n ? ' print-frame--hit' : ''}`,
            children: i.jsxs('div', {
              className: 'card-frame',
              children: [
                e.imageUrl && !s
                  ? i.jsx('img', {
                      src: e.imageUrl,
                      alt: '',
                      loading: 'lazy',
                      decoding: 'async',
                      onError: () => u(!0),
                      className: 'card-img',
                    })
                  : i.jsx('div', {
                      className: 'card-figure',
                      children: i.jsx(Xs, { variant: e.figureVariant, title: e.name }),
                    }),
                l ? i.jsx('span', { className: 'soldout-flag', children: r.soldOutLabel }) : null,
                o
                  ? i.jsxs('span', {
                      className: 'soldout-flag soldout-flag--low',
                      children: ['Restam ', a],
                    })
                  : null,
              ],
            }),
          }),
          i.jsx('p', { className: 'card-cat', children: t }),
          i.jsx('h3', { className: 'card-name', children: e.name }),
          i.jsxs('div', {
            className: 'card-foot',
            children: [
              i.jsx('span', { className: 'card-price', children: tl(e.basePriceCents) }),
              i.jsx('span', { className: 'card-cta', children: r.cardCta }),
            ],
          }),
        ],
      }),
    }),
  });
}
function m1({ settings: e }) {
  const { categories: t, loading: n, error: r, refetch: l } = ul(),
    { cart: a } = pt(),
    [o, s] = x.useState('all'),
    [u, c] = x.useState(''),
    [m, d] = x.useState(null),
    f = x.useRef(!1),
    v = x.useMemo(
      () =>
        t.flatMap((h) =>
          h.products
            .filter((p) => p.status !== 'archived')
            .map((p) => ({ product: p, category: h })),
        ),
      [t],
    ),
    k = x.useMemo(() => {
      const h = To(u.trim());
      return v.filter(
        ({ product: p, category: g }) =>
          (o === 'all' || g.id === o) &&
          (!h || To(p.name).includes(h) || To(p.description ?? '').includes(h)),
      );
    }, [v, o, u]);
  x.useEffect(() => {
    if (f.current || v.length === 0) return;
    const h = window.location.hash;
    if (!h.startsWith('#produto-')) return;
    f.current = !0;
    const p = h.slice(1);
    requestAnimationFrame(() => {
      const g = document.getElementById(p);
      if (!g) return;
      const y = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      (g.scrollIntoView({ behavior: y ? 'instant' : 'smooth', block: 'center' }),
        d(p),
        window.setTimeout(() => d((S) => (S === p ? null : S)), 2e3));
    });
  }, [v]);
  const w = (a == null ? void 0 : a.status) === 'open' ? a.totals.itemCount : 0,
    j = u.trim() !== '' || o !== 'all';
  return i.jsxs(i.Fragment, {
    children: [
      i.jsxs('section', {
        className: 'container',
        style: { paddingBlock: '40px 32px' },
        children: [
          e.eyebrow ? i.jsx('p', { className: 'eyebrow', children: e.eyebrow }) : null,
          i.jsx('h1', {
            className: 'display display-lg',
            style: { marginTop: 12 },
            children: e.title,
          }),
          e.lede
            ? i.jsx('p', {
                className: 'lede small muted',
                style: { marginTop: 12, maxWidth: '36rem' },
                children: e.lede,
              })
            : null,
          i.jsxs('form', {
            role: 'search',
            className: 'search-wrap',
            style: { marginTop: 28 },
            onSubmit: (h) => h.preventDefault(),
            children: [
              i.jsx('span', {
                className: 'search-icon',
                children: i.jsx(s1, { size: 16, 'aria-hidden': 'true' }),
              }),
              i.jsx('label', { htmlFor: 'busca', className: 'sr-label', children: e.searchLabel }),
              i.jsx('input', {
                id: 'busca',
                type: 'search',
                inputMode: 'search',
                enterKeyHint: 'search',
                autoComplete: 'off',
                maxLength: 80,
                className: 'search-input',
                placeholder: e.searchPlaceholder,
                value: u,
                onChange: (h) => c(h.target.value),
              }),
              u
                ? i.jsx('button', {
                    type: 'button',
                    className: 'search-clear',
                    'aria-label': 'Limpar busca',
                    onClick: () => c(''),
                    children: i.jsx(d1, { size: 16, 'aria-hidden': 'true' }),
                  })
                : null,
            ],
          }),
        ],
      }),
      i.jsxs('section', {
        id: 'cardapio',
        className: 'container',
        style: { paddingBottom: 80, scrollMarginTop: 120 },
        children: [
          i.jsx('div', { className: 'ficha-rule', style: { paddingTop: 12 } }),
          i.jsxs('div', {
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            },
            children: [
              i.jsx('nav', {
                className: 'cat-tabs',
                'aria-label': 'Categorias',
                children: [{ id: 'all', name: e.allLabel }, ...t].map((h) =>
                  i.jsx(
                    'button',
                    {
                      type: 'button',
                      className: 'cat-tab',
                      'aria-pressed': o === h.id,
                      'data-active': o === h.id || void 0,
                      onClick: () => s(h.id),
                      children: h.name,
                    },
                    h.id,
                  ),
                ),
              }),
              i.jsx('p', {
                role: 'status',
                className: 'small muted tnum',
                style: { margin: 0, minHeight: 16 },
                children:
                  t.length > 0
                    ? `${k.length} ${k.length === 1 ? e.itemSingular : e.itemPlural}`
                    : '',
              }),
            ],
          }),
          i.jsx(Ue, { name: 'before-grid' }),
          i.jsx('div', {
            style: { marginTop: 40 },
            children:
              n && t.length === 0
                ? i.jsx('div', {
                    className: 'card-grid',
                    'aria-busy': 'true',
                    'aria-label': 'Carregando cardápio',
                    children: Array.from({ length: 8 }, (h, p) =>
                      i.jsxs(
                        'div',
                        {
                          children: [
                            i.jsx(Un, { style: { aspectRatio: '1', width: '100%' } }),
                            i.jsxs('div', {
                              style: { paddingTop: 12, display: 'grid', gap: 8 },
                              children: [
                                i.jsx(Un, { style: { height: 12, width: '45%' } }),
                                i.jsx(Un, { style: { height: 22, width: '80%' } }),
                              ],
                            }),
                          ],
                        },
                        p,
                      ),
                    ),
                  })
                : r && t.length === 0
                  ? i.jsxs('div', {
                      role: 'alert',
                      className: 'empty-state ficha-rule',
                      children: [
                        i.jsx(o1, { size: 20, 'aria-hidden': 'true' }),
                        i.jsx('h3', { children: e.emptyTitle }),
                        i.jsx('button', {
                          type: 'button',
                          className: 'btn',
                          onClick: l,
                          children: 'Tentar novamente',
                        }),
                      ],
                    })
                  : k.length === 0
                    ? i.jsxs('div', {
                        className: 'empty-state ficha-rule',
                        children: [
                          i.jsx(i1, { size: 20, 'aria-hidden': 'true' }),
                          i.jsx('h3', { children: j ? e.noMatchTitle : e.emptyTitle }),
                          !j && e.emptyText ? i.jsx('p', { children: e.emptyText }) : null,
                          j
                            ? i.jsx('button', {
                                type: 'button',
                                className: 'btn',
                                onClick: () => {
                                  (c(''), s('all'));
                                },
                                children: e.resetLabel,
                              })
                            : null,
                        ],
                      })
                    : i.jsx('ol', {
                        className: 'card-grid',
                        children: k.map(({ product: h, category: p }) =>
                          i.jsx(
                            h1,
                            {
                              product: h,
                              category: p.name,
                              highlighted: m === `produto-${h.slug}`,
                              s: e,
                            },
                            h.id,
                          ),
                        ),
                      }),
          }),
        ],
      }),
      w > 0
        ? i.jsx('div', {
            className: 'floating-sacola',
            children: i.jsx(Ya, {
              asChild: !0,
              children: i.jsxs('button', {
                type: 'button',
                children: [
                  i.jsxs('span', {
                    style: { display: 'inline-flex', alignItems: 'center', gap: 8 },
                    children: [
                      i.jsx(Gs, { size: 16, 'aria-hidden': 'true' }),
                      w,
                      ' ',
                      w === 1 ? e.itemSingular : e.itemPlural,
                    ],
                  }),
                  i.jsx('span', { style: { fontWeight: 500 }, children: e.bagLabel }),
                ],
              }),
            }),
          })
        : null,
    ],
  });
}
const g1 = Object.freeze(
    Object.defineProperty({ __proto__: null, default: m1, schema: p1 }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  v1 = ne({
    type: 'store:closing',
    settings: {
      eyebrow: E({ max: 60 }),
      title: E({ max: 80, default: '' }),
      text: E({ max: 200 }),
      ctaLabel: E({ max: 40 }),
      ctaHref: Me(),
    },
  });
function y1({ settings: e }) {
  return i.jsx('section', {
    className: 'ficha-rule closing',
    children: i.jsxs('div', {
      className: 'container',
      style: { paddingBlock: 64 },
      children: [
        e.eyebrow ? i.jsx('p', { className: 'eyebrow', children: e.eyebrow }) : null,
        i.jsx('h2', {
          className: 'display display-lg',
          style: { marginTop: 16 },
          children: e.title,
        }),
        e.text
          ? i.jsx('p', { className: 'hero-sub', style: { marginTop: 8 }, children: e.text })
          : null,
        e.ctaLabel && e.ctaHref
          ? i.jsx(ut, {
              to: e.ctaHref,
              className: 'btn',
              style: { marginTop: 32 },
              children: e.ctaLabel,
            })
          : null,
      ],
    }),
  });
}
const x1 = Object.freeze(
    Object.defineProperty({ __proto__: null, default: y1, schema: v1 }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  w1 = ne({
    type: 'store:footer',
    settings: {
      eyebrow: E({ max: 60 }),
      logo: cl({ default: '/brand/logo-principal.png' }),
      blurb: E({ max: 160 }),
      contactsTitle: E({ max: 40, default: 'Contato' }),
      links: vn({ label: E({ max: 40, default: '' }), href: Me({ default: '/' }) }, { max: 6 }),
      qrLabel: E({ max: 40 }),
      qrHref: Me(),
    },
    areas: { extra: { accepts: ['info', 'social-proof', 'promo'], max: 2 } },
  }),
  k1 = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function j1(e) {
  const t = (e == null ? void 0 : e.windows) ?? [];
  return t.length === 0
    ? null
    : t
        .map(
          (n) =>
            `${
              n.days.length === 7
                ? 'todos os dias'
                : [...n.days]
                    .sort()
                    .map((l) => k1[l])
                    .join(' · ')
            }, ${n.open}–${n.close}`,
        )
        .join('  ·  ');
}
function S1({ settings: e }) {
  var a, o;
  const { store: t } = X(),
    n = (a = t == null ? void 0 : t.instagram) == null ? void 0 : a.replace(/^@/, ''),
    r = (o = t == null ? void 0 : t.whatsapp) == null ? void 0 : o.replace(/\D/g, ''),
    l = j1(t == null ? void 0 : t.hours);
  return i.jsx('footer', {
    className: 'site-footer',
    children: i.jsxs('div', {
      className: 'container',
      children: [
        e.eyebrow ? i.jsx('p', { className: 'eyebrow', children: e.eyebrow }) : null,
        i.jsxs('div', {
          className: 'footer-grid',
          children: [
            i.jsxs('div', {
              children: [
                i.jsx('img', {
                  src: e.logo,
                  alt: t ? `${t.name} — ${t.tagline ?? ''}` : '',
                  className: 'brand-img footer-logo',
                }),
                e.blurb
                  ? i.jsx('p', {
                      className: 'small muted',
                      style: { marginTop: 12, maxWidth: '20rem' },
                      children: e.blurb,
                    })
                  : null,
                t != null && t.address
                  ? i.jsxs('p', {
                      className: 'small muted',
                      style: { marginTop: 16, fontSize: '0.75rem' },
                      children: [t.address, t.city ? `, ${t.city}` : ''],
                    })
                  : null,
                l
                  ? i.jsx('p', {
                      className: 'small muted tnum',
                      style: { marginTop: 4, fontSize: '0.75rem' },
                      children: l,
                    })
                  : null,
                i.jsx(Ue, { name: 'extra' }),
              ],
            }),
            i.jsxs('nav', {
              className: 'footer-nav',
              'aria-label': 'Contatos da loja',
              children: [
                i.jsx('p', {
                  className: 'eyebrow',
                  style: { fontSize: '0.875rem' },
                  children: e.contactsTitle,
                }),
                (e.links ?? []).map((s) => i.jsx(ut, { to: s.href, children: s.label }, s.href)),
                e.qrLabel && e.qrHref
                  ? i.jsxs(ut, {
                      to: e.qrHref,
                      children: [i.jsx(a1, { size: 16, 'aria-hidden': 'true' }), ' ', e.qrLabel],
                    })
                  : null,
                n
                  ? i.jsxs('a', {
                      href: `https://www.instagram.com/${n}/`,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      children: [
                        i.jsx(Pp, { size: 16, 'aria-hidden': 'true' }),
                        ' Instagram @',
                        n,
                        ' ',
                        i.jsx(Pc, { size: 14, 'aria-hidden': 'true' }),
                      ],
                    })
                  : null,
                r
                  ? i.jsxs('a', {
                      href: `https://wa.me/${r}`,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      children: [
                        i.jsx(Tp, { size: 16, 'aria-hidden': 'true' }),
                        ' WhatsApp',
                        ' ',
                        i.jsx(Pc, { size: 14, 'aria-hidden': 'true' }),
                      ],
                    })
                  : null,
              ],
            }),
          ],
        }),
        i.jsxs('div', {
          className: 'footer-legal',
          children: [
            i.jsxs('p', {
              style: { margin: 0 },
              children: ['© ', new Date().getFullYear(), ' ', (t == null ? void 0 : t.name) ?? ''],
            }),
            t != null && t.tagline
              ? i.jsx('p', { style: { margin: 0 }, children: t.tagline })
              : null,
          ],
        }),
      ],
    }),
  });
}
const N1 = Object.freeze(
    Object.defineProperty({ __proto__: null, default: S1, schema: w1 }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  C1 = ne({
    type: 'store:header',
    settings: {
      logo: cl({ default: '/brand/icone-liso.png' }),
      links: vn({ label: E({ max: 40, default: '' }), href: Me({ default: '/' }) }, { max: 6 }),
      storyAnchor: E({ max: 40 }),
      cartLabel: E({ max: 20, default: 'Sacola' }),
      showStatus: et({ default: !0 }),
    },
    areas: { actions: { accepts: ['badge', 'info'], max: 1 } },
  });
function E1({ settings: e }) {
  const { store: t } = X(),
    { cart: n } = pt(),
    r = (n == null ? void 0 : n.status) === 'open' ? n.totals.itemCount : 0;
  return i.jsxs('header', {
    className: 'site-header',
    children: [
      i.jsx('a', { href: '#main', className: 'skip-link', children: 'Pular para o conteúdo' }),
      i.jsxs('div', {
        className: 'container site-header-inner',
        children: [
          i.jsxs(ut, {
            to: '/',
            className: 'brand-link',
            'aria-label': `${(t == null ? void 0 : t.name) ?? 'Loja'} — início`,
            children: [
              i.jsx('img', { src: e.logo, alt: '', 'aria-hidden': 'true', className: 'brand-img' }),
              i.jsxs('span', {
                className: 'brand-lockup',
                children: [
                  i.jsx('span', {
                    className: 'brand-name',
                    children: (t == null ? void 0 : t.name) ?? '',
                  }),
                  t != null && t.tagline
                    ? i.jsx('span', { className: 'brand-tag', children: t.tagline })
                    : null,
                ],
              }),
            ],
          }),
          i.jsx('nav', {
            className: 'site-nav',
            'aria-label': 'Navegação principal',
            children: (e.links ?? []).map((l) =>
              e.storyAnchor && l.href.endsWith(`#${e.storyAnchor}`)
                ? i.jsx(_1, { href: l.href, anchor: e.storyAnchor, label: l.label }, l.href)
                : i.jsx(Ov, { to: l.href, end: l.href === '/', children: l.label }, l.href),
            ),
          }),
          i.jsxs('div', {
            className: 'header-actions',
            children: [
              e.showStatus
                ? i.jsx('span', { className: 'header-status', children: i.jsx(Ys, {}) })
                : null,
              i.jsx(Ya, {
                asChild: !0,
                children: i.jsxs('button', {
                  type: 'button',
                  className: 'sacola-btn',
                  children: [
                    i.jsx(Gs, { size: 16, 'aria-hidden': 'true' }),
                    i.jsx('span', { className: 'sacola-word', children: e.cartLabel }),
                    i.jsx('span', { className: 'sacola-count', children: r }),
                  ],
                }),
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function _1({ href: e, anchor: t, label: n }) {
  const { pathname: r } = nt(),
    [l, a] = x.useState(!1),
    o = r === (e.split('#')[0] || '/');
  return (
    x.useEffect(() => {
      if (!o) {
        a(!1);
        return;
      }
      let s = !1;
      const u = () => {
        s ||
          ((s = !0),
          requestAnimationFrame(() => {
            s = !1;
            const c = document.getElementById(t);
            if (!c) return a(!1);
            const m = c.getBoundingClientRect();
            a(m.top < window.innerHeight * 0.45 && m.bottom > 120);
          }));
      };
      return (
        u(),
        window.addEventListener('scroll', u, { passive: !0 }),
        () => window.removeEventListener('scroll', u)
      );
    }, [o, t]),
    i.jsx(ut, { to: e, 'aria-current': l ? 'true' : void 0, children: n })
  );
}
const P1 = Object.freeze(
    Object.defineProperty({ __proto__: null, default: E1, schema: C1 }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  T1 = ne({
    type: 'store:hero',
    settings: {
      eyebrow: E({ max: 80 }),
      title: E({ max: 60, default: '' }),
      titleEmphasis: E({ max: 60 }),
      text: E({ max: 300 }),
      ctaLabel: E({ max: 40 }),
      ctaHref: Me(),
      secondaryLabel: E({ max: 40 }),
      secondaryHref: Me(),
      image: cl(),
      imageAlt: E({ max: 160, default: '' }),
      figTitle: E({ max: 60 }),
      figSub: E({ max: 80 }),
    },
    areas: { after: { accepts: ['promo', 'badge', 'info'], max: 2 } },
  });
function L1({ settings: e }) {
  const { store: t } = X(),
    n = (r) => (r == null ? void 0 : r.replaceAll('{city}', (t == null ? void 0 : t.city) ?? ''));
  return i.jsxs('section', {
    className: 'container',
    style: { paddingBlock: '40px 48px' },
    children: [
      e.eyebrow
        ? i.jsx('p', { className: 'eyebrow rise-in rise-in-1', children: n(e.eyebrow) })
        : null,
      i.jsxs('div', {
        className: 'hero-grid',
        style: { marginTop: 16 },
        children: [
          i.jsxs('div', {
            children: [
              i.jsxs('h1', {
                className: 'display display-xl rise-in rise-in-2',
                children: [
                  e.title,
                  e.titleEmphasis
                    ? i.jsxs(i.Fragment, {
                        children: [i.jsx('br', {}), i.jsx('em', { children: e.titleEmphasis })],
                      })
                    : null,
                ],
              }),
              e.text
                ? i.jsx('p', { className: 'hero-sub rise-in rise-in-3', children: n(e.text) })
                : null,
              i.jsxs('div', {
                className: 'hero-cta rise-in rise-in-4',
                children: [
                  e.ctaLabel && e.ctaHref
                    ? i.jsx(ut, { to: e.ctaHref, className: 'btn', children: e.ctaLabel })
                    : null,
                  e.secondaryLabel && e.secondaryHref
                    ? i.jsx(ut, {
                        to: e.secondaryHref,
                        className: 'btn-ghost',
                        children: e.secondaryLabel,
                      })
                    : null,
                ],
              }),
              i.jsx(Ue, { name: 'after', className: 'hero-after' }),
            ],
          }),
          e.image
            ? i.jsxs('figure', {
                className: 'hero-fig rise-in rise-in-3',
                children: [
                  i.jsx('div', {
                    className: 'print-frame',
                    children: i.jsx('div', {
                      className: 'card-frame',
                      style: { aspectRatio: '4/3' },
                      children: i.jsx('img', {
                        src: e.image,
                        alt: e.imageAlt,
                        fetchPriority: 'high',
                        decoding: 'async',
                      }),
                    }),
                  }),
                  e.figTitle || e.figSub
                    ? i.jsxs('figcaption', {
                        children: [
                          e.figTitle
                            ? i.jsx('span', { className: 'fig-title', children: e.figTitle })
                            : null,
                          e.figSub
                            ? i.jsx('span', { className: 'fig-sub', children: e.figSub })
                            : null,
                        ],
                      })
                    : null,
                ],
              })
            : null,
        ],
      }),
    ],
  });
}
const R1 = Object.freeze(
    Object.defineProperty({ __proto__: null, default: L1, schema: T1 }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  b1 = dl({ type: 'store:product-figure', category: 'media', settings: {} });
function M1(e) {
  const { params: t } = fl(),
    { product: n } = Hs(t.slug ?? '');
  return n
    ? n.imageUrl
      ? i.jsx('img', { src: n.imageUrl, alt: n.name, className: 'pd-img', fetchPriority: 'high' })
      : i.jsx('div', {
          className: 'pd-figure',
          children: i.jsx(Xs, { variant: n.figureVariant, title: n.name }),
        })
    : null;
}
const O1 = Object.freeze(
    Object.defineProperty({ __proto__: null, default: M1, schema: b1 }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  I1 = { truck: Rp, snowflake: Lp },
  A1 = dl({
    type: 'store:product-perks',
    category: 'info',
    settings: {
      items: vn(
        {
          icon: tt(['truck', 'snowflake'], { default: 'truck' }),
          text: E({ max: 80, default: '' }),
        },
        { max: 3 },
      ),
    },
  });
function D1({ settings: e }) {
  const { store: t } = X(),
    n = e.items ?? [];
  return n.length === 0
    ? null
    : i.jsx('p', {
        className: 'small muted pd-perks',
        children: n.map((r) => {
          const l = I1[r.icon];
          return i.jsxs(
            'span',
            {
              children: [
                i.jsx(l, { size: 16, 'aria-hidden': 'true' }),
                r.text.replaceAll('{city}', (t == null ? void 0 : t.city) ?? ''),
              ],
            },
            r.text,
          );
        }),
      });
}
const z1 = Object.freeze(
  Object.defineProperty({ __proto__: null, default: D1, schema: A1 }, Symbol.toStringTag, {
    value: 'Module',
  }),
);
var Xn = {},
  B1 = function () {
    return typeof Promise == 'function' && Promise.prototype && Promise.prototype.then;
  },
  Mp = {},
  Ae = {};
let Zs;
const F1 = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
  1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876,
  3034, 3196, 3362, 3532, 3706,
];
Ae.getSymbolSize = function (t) {
  if (!t) throw new Error('"version" cannot be null or undefined');
  if (t < 1 || t > 40) throw new Error('"version" should be in range from 1 to 40');
  return t * 4 + 17;
};
Ae.getSymbolTotalCodewords = function (t) {
  return F1[t];
};
Ae.getBCHDigit = function (e) {
  let t = 0;
  for (; e !== 0;) (t++, (e >>>= 1));
  return t;
};
Ae.setToSJISFunction = function (t) {
  if (typeof t != 'function') throw new Error('"toSJISFunc" is not a valid function.');
  Zs = t;
};
Ae.isKanjiModeEnabled = function () {
  return typeof Zs < 'u';
};
Ae.toSJIS = function (t) {
  return Zs(t);
};
var Ja = {};
(function (e) {
  ((e.L = { bit: 1 }), (e.M = { bit: 0 }), (e.Q = { bit: 3 }), (e.H = { bit: 2 }));
  function t(n) {
    if (typeof n != 'string') throw new Error('Param is not a string');
    switch (n.toLowerCase()) {
      case 'l':
      case 'low':
        return e.L;
      case 'm':
      case 'medium':
        return e.M;
      case 'q':
      case 'quartile':
        return e.Q;
      case 'h':
      case 'high':
        return e.H;
      default:
        throw new Error('Unknown EC Level: ' + n);
    }
  }
  ((e.isValid = function (r) {
    return r && typeof r.bit < 'u' && r.bit >= 0 && r.bit < 4;
  }),
    (e.from = function (r, l) {
      if (e.isValid(r)) return r;
      try {
        return t(r);
      } catch {
        return l;
      }
    }));
})(Ja);
function Op() {
  ((this.buffer = []), (this.length = 0));
}
Op.prototype = {
  get: function (e) {
    const t = Math.floor(e / 8);
    return ((this.buffer[t] >>> (7 - (e % 8))) & 1) === 1;
  },
  put: function (e, t) {
    for (let n = 0; n < t; n++) this.putBit(((e >>> (t - n - 1)) & 1) === 1);
  },
  getLengthInBits: function () {
    return this.length;
  },
  putBit: function (e) {
    const t = Math.floor(this.length / 8);
    (this.buffer.length <= t && this.buffer.push(0),
      e && (this.buffer[t] |= 128 >>> (this.length % 8)),
      this.length++);
  },
};
var $1 = Op;
function hl(e) {
  if (!e || e < 1) throw new Error('BitMatrix size must be defined and greater than 0');
  ((this.size = e),
    (this.data = new Uint8Array(e * e)),
    (this.reservedBit = new Uint8Array(e * e)));
}
hl.prototype.set = function (e, t, n, r) {
  const l = e * this.size + t;
  ((this.data[l] = n), r && (this.reservedBit[l] = !0));
};
hl.prototype.get = function (e, t) {
  return this.data[e * this.size + t];
};
hl.prototype.xor = function (e, t, n) {
  this.data[e * this.size + t] ^= n;
};
hl.prototype.isReserved = function (e, t) {
  return this.reservedBit[e * this.size + t];
};
var U1 = hl,
  Ip = {};
(function (e) {
  const t = Ae.getSymbolSize;
  ((e.getRowColCoords = function (r) {
    if (r === 1) return [];
    const l = Math.floor(r / 7) + 2,
      a = t(r),
      o = a === 145 ? 26 : Math.ceil((a - 13) / (2 * l - 2)) * 2,
      s = [a - 7];
    for (let u = 1; u < l - 1; u++) s[u] = s[u - 1] - o;
    return (s.push(6), s.reverse());
  }),
    (e.getPositions = function (r) {
      const l = [],
        a = e.getRowColCoords(r),
        o = a.length;
      for (let s = 0; s < o; s++)
        for (let u = 0; u < o; u++)
          (s === 0 && u === 0) ||
            (s === 0 && u === o - 1) ||
            (s === o - 1 && u === 0) ||
            l.push([a[s], a[u]]);
      return l;
    }));
})(Ip);
var Ap = {};
const V1 = Ae.getSymbolSize,
  Tc = 7;
Ap.getPositions = function (t) {
  const n = V1(t);
  return [
    [0, 0],
    [n - Tc, 0],
    [0, n - Tc],
  ];
};
var Dp = {};
(function (e) {
  e.Patterns = {
    PATTERN000: 0,
    PATTERN001: 1,
    PATTERN010: 2,
    PATTERN011: 3,
    PATTERN100: 4,
    PATTERN101: 5,
    PATTERN110: 6,
    PATTERN111: 7,
  };
  const t = { N1: 3, N2: 3, N3: 40, N4: 10 };
  ((e.isValid = function (l) {
    return l != null && l !== '' && !isNaN(l) && l >= 0 && l <= 7;
  }),
    (e.from = function (l) {
      return e.isValid(l) ? parseInt(l, 10) : void 0;
    }),
    (e.getPenaltyN1 = function (l) {
      const a = l.size;
      let o = 0,
        s = 0,
        u = 0,
        c = null,
        m = null;
      for (let d = 0; d < a; d++) {
        ((s = u = 0), (c = m = null));
        for (let f = 0; f < a; f++) {
          let v = l.get(d, f);
          (v === c ? s++ : (s >= 5 && (o += t.N1 + (s - 5)), (c = v), (s = 1)),
            (v = l.get(f, d)),
            v === m ? u++ : (u >= 5 && (o += t.N1 + (u - 5)), (m = v), (u = 1)));
        }
        (s >= 5 && (o += t.N1 + (s - 5)), u >= 5 && (o += t.N1 + (u - 5)));
      }
      return o;
    }),
    (e.getPenaltyN2 = function (l) {
      const a = l.size;
      let o = 0;
      for (let s = 0; s < a - 1; s++)
        for (let u = 0; u < a - 1; u++) {
          const c = l.get(s, u) + l.get(s, u + 1) + l.get(s + 1, u) + l.get(s + 1, u + 1);
          (c === 4 || c === 0) && o++;
        }
      return o * t.N2;
    }),
    (e.getPenaltyN3 = function (l) {
      const a = l.size;
      let o = 0,
        s = 0,
        u = 0;
      for (let c = 0; c < a; c++) {
        s = u = 0;
        for (let m = 0; m < a; m++)
          ((s = ((s << 1) & 2047) | l.get(c, m)),
            m >= 10 && (s === 1488 || s === 93) && o++,
            (u = ((u << 1) & 2047) | l.get(m, c)),
            m >= 10 && (u === 1488 || u === 93) && o++);
      }
      return o * t.N3;
    }),
    (e.getPenaltyN4 = function (l) {
      let a = 0;
      const o = l.data.length;
      for (let u = 0; u < o; u++) a += l.data[u];
      return Math.abs(Math.ceil((a * 100) / o / 5) - 10) * t.N4;
    }));
  function n(r, l, a) {
    switch (r) {
      case e.Patterns.PATTERN000:
        return (l + a) % 2 === 0;
      case e.Patterns.PATTERN001:
        return l % 2 === 0;
      case e.Patterns.PATTERN010:
        return a % 3 === 0;
      case e.Patterns.PATTERN011:
        return (l + a) % 3 === 0;
      case e.Patterns.PATTERN100:
        return (Math.floor(l / 2) + Math.floor(a / 3)) % 2 === 0;
      case e.Patterns.PATTERN101:
        return ((l * a) % 2) + ((l * a) % 3) === 0;
      case e.Patterns.PATTERN110:
        return (((l * a) % 2) + ((l * a) % 3)) % 2 === 0;
      case e.Patterns.PATTERN111:
        return (((l * a) % 3) + ((l + a) % 2)) % 2 === 0;
      default:
        throw new Error('bad maskPattern:' + r);
    }
  }
  ((e.applyMask = function (l, a) {
    const o = a.size;
    for (let s = 0; s < o; s++)
      for (let u = 0; u < o; u++) a.isReserved(u, s) || a.xor(u, s, n(l, u, s));
  }),
    (e.getBestMask = function (l, a) {
      const o = Object.keys(e.Patterns).length;
      let s = 0,
        u = 1 / 0;
      for (let c = 0; c < o; c++) {
        (a(c), e.applyMask(c, l));
        const m = e.getPenaltyN1(l) + e.getPenaltyN2(l) + e.getPenaltyN3(l) + e.getPenaltyN4(l);
        (e.applyMask(c, l), m < u && ((u = m), (s = c)));
      }
      return s;
    }));
})(Dp);
var Ga = {};
const Dt = Ja,
  Il = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4, 2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6,
    2, 5, 8, 8, 4, 5, 8, 8, 4, 5, 8, 11, 4, 8, 10, 11, 4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18, 6,
    10, 17, 16, 6, 11, 16, 19, 6, 13, 18, 21, 7, 14, 21, 25, 8, 16, 20, 25, 8, 17, 23, 25, 9, 17,
    23, 34, 9, 18, 25, 30, 10, 20, 27, 32, 12, 21, 29, 35, 12, 23, 34, 37, 12, 25, 34, 40, 13, 26,
    35, 42, 14, 28, 38, 45, 15, 29, 40, 48, 16, 31, 43, 51, 17, 33, 45, 54, 18, 35, 48, 57, 19, 37,
    51, 60, 19, 38, 53, 63, 20, 40, 56, 66, 21, 43, 59, 70, 22, 45, 62, 74, 24, 47, 65, 77, 25, 49,
    68, 81,
  ],
  Al = [
    7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64, 26, 48, 72, 88, 36, 64, 96, 112,
    40, 72, 108, 130, 48, 88, 132, 156, 60, 110, 160, 192, 72, 130, 192, 224, 80, 150, 224, 264, 96,
    176, 260, 308, 104, 198, 288, 352, 120, 216, 320, 384, 132, 240, 360, 432, 144, 280, 408, 480,
    168, 308, 448, 532, 180, 338, 504, 588, 196, 364, 546, 650, 224, 416, 600, 700, 224, 442, 644,
    750, 252, 476, 690, 816, 270, 504, 750, 900, 300, 560, 810, 960, 312, 588, 870, 1050, 336, 644,
    952, 1110, 360, 700, 1020, 1200, 390, 728, 1050, 1260, 420, 784, 1140, 1350, 450, 812, 1200,
    1440, 480, 868, 1290, 1530, 510, 924, 1350, 1620, 540, 980, 1440, 1710, 570, 1036, 1530, 1800,
    570, 1064, 1590, 1890, 600, 1120, 1680, 1980, 630, 1204, 1770, 2100, 660, 1260, 1860, 2220, 720,
    1316, 1950, 2310, 750, 1372, 2040, 2430,
  ];
Ga.getBlocksCount = function (t, n) {
  switch (n) {
    case Dt.L:
      return Il[(t - 1) * 4 + 0];
    case Dt.M:
      return Il[(t - 1) * 4 + 1];
    case Dt.Q:
      return Il[(t - 1) * 4 + 2];
    case Dt.H:
      return Il[(t - 1) * 4 + 3];
    default:
      return;
  }
};
Ga.getTotalCodewordsCount = function (t, n) {
  switch (n) {
    case Dt.L:
      return Al[(t - 1) * 4 + 0];
    case Dt.M:
      return Al[(t - 1) * 4 + 1];
    case Dt.Q:
      return Al[(t - 1) * 4 + 2];
    case Dt.H:
      return Al[(t - 1) * 4 + 3];
    default:
      return;
  }
};
var zp = {},
  Xa = {};
const Mr = new Uint8Array(512),
  ja = new Uint8Array(256);
(function () {
  let t = 1;
  for (let n = 0; n < 255; n++) ((Mr[n] = t), (ja[t] = n), (t <<= 1), t & 256 && (t ^= 285));
  for (let n = 255; n < 512; n++) Mr[n] = Mr[n - 255];
})();
Xa.log = function (t) {
  if (t < 1) throw new Error('log(' + t + ')');
  return ja[t];
};
Xa.exp = function (t) {
  return Mr[t];
};
Xa.mul = function (t, n) {
  return t === 0 || n === 0 ? 0 : Mr[ja[t] + ja[n]];
};
(function (e) {
  const t = Xa;
  ((e.mul = function (r, l) {
    const a = new Uint8Array(r.length + l.length - 1);
    for (let o = 0; o < r.length; o++)
      for (let s = 0; s < l.length; s++) a[o + s] ^= t.mul(r[o], l[s]);
    return a;
  }),
    (e.mod = function (r, l) {
      let a = new Uint8Array(r);
      for (; a.length - l.length >= 0;) {
        const o = a[0];
        for (let u = 0; u < l.length; u++) a[u] ^= t.mul(l[u], o);
        let s = 0;
        for (; s < a.length && a[s] === 0;) s++;
        a = a.slice(s);
      }
      return a;
    }),
    (e.generateECPolynomial = function (r) {
      let l = new Uint8Array([1]);
      for (let a = 0; a < r; a++) l = e.mul(l, new Uint8Array([1, t.exp(a)]));
      return l;
    }));
})(zp);
const Bp = zp;
function eu(e) {
  ((this.genPoly = void 0), (this.degree = e), this.degree && this.initialize(this.degree));
}
eu.prototype.initialize = function (t) {
  ((this.degree = t), (this.genPoly = Bp.generateECPolynomial(this.degree)));
};
eu.prototype.encode = function (t) {
  if (!this.genPoly) throw new Error('Encoder not initialized');
  const n = new Uint8Array(t.length + this.degree);
  n.set(t);
  const r = Bp.mod(n, this.genPoly),
    l = this.degree - r.length;
  if (l > 0) {
    const a = new Uint8Array(this.degree);
    return (a.set(r, l), a);
  }
  return r;
};
var H1 = eu,
  Fp = {},
  Xt = {},
  tu = {};
tu.isValid = function (t) {
  return !isNaN(t) && t >= 1 && t <= 40;
};
var ht = {};
const $p = '[0-9]+',
  W1 = '[A-Z $%*+\\-./:]+';
let nl =
  '(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+';
nl = nl.replace(/u/g, '\\u');
const Q1 =
  '(?:(?![A-Z0-9 $%*+\\-./:]|' +
  nl +
  `)(?:.|[\r
]))+`;
ht.KANJI = new RegExp(nl, 'g');
ht.BYTE_KANJI = new RegExp('[^A-Z0-9 $%*+\\-./:]+', 'g');
ht.BYTE = new RegExp(Q1, 'g');
ht.NUMERIC = new RegExp($p, 'g');
ht.ALPHANUMERIC = new RegExp(W1, 'g');
const K1 = new RegExp('^' + nl + '$'),
  q1 = new RegExp('^' + $p + '$'),
  Y1 = new RegExp('^[A-Z0-9 $%*+\\-./:]+$');
ht.testKanji = function (t) {
  return K1.test(t);
};
ht.testNumeric = function (t) {
  return q1.test(t);
};
ht.testAlphanumeric = function (t) {
  return Y1.test(t);
};
(function (e) {
  const t = tu,
    n = ht;
  ((e.NUMERIC = { id: 'Numeric', bit: 1, ccBits: [10, 12, 14] }),
    (e.ALPHANUMERIC = { id: 'Alphanumeric', bit: 2, ccBits: [9, 11, 13] }),
    (e.BYTE = { id: 'Byte', bit: 4, ccBits: [8, 16, 16] }),
    (e.KANJI = { id: 'Kanji', bit: 8, ccBits: [8, 10, 12] }),
    (e.MIXED = { bit: -1 }),
    (e.getCharCountIndicator = function (a, o) {
      if (!a.ccBits) throw new Error('Invalid mode: ' + a);
      if (!t.isValid(o)) throw new Error('Invalid version: ' + o);
      return o >= 1 && o < 10 ? a.ccBits[0] : o < 27 ? a.ccBits[1] : a.ccBits[2];
    }),
    (e.getBestModeForData = function (a) {
      return n.testNumeric(a)
        ? e.NUMERIC
        : n.testAlphanumeric(a)
          ? e.ALPHANUMERIC
          : n.testKanji(a)
            ? e.KANJI
            : e.BYTE;
    }),
    (e.toString = function (a) {
      if (a && a.id) return a.id;
      throw new Error('Invalid mode');
    }),
    (e.isValid = function (a) {
      return a && a.bit && a.ccBits;
    }));
  function r(l) {
    if (typeof l != 'string') throw new Error('Param is not a string');
    switch (l.toLowerCase()) {
      case 'numeric':
        return e.NUMERIC;
      case 'alphanumeric':
        return e.ALPHANUMERIC;
      case 'kanji':
        return e.KANJI;
      case 'byte':
        return e.BYTE;
      default:
        throw new Error('Unknown mode: ' + l);
    }
  }
  e.from = function (a, o) {
    if (e.isValid(a)) return a;
    try {
      return r(a);
    } catch {
      return o;
    }
  };
})(Xt);
(function (e) {
  const t = Ae,
    n = Ga,
    r = Ja,
    l = Xt,
    a = tu,
    o = 7973,
    s = t.getBCHDigit(o);
  function u(f, v, k) {
    for (let w = 1; w <= 40; w++) if (v <= e.getCapacity(w, k, f)) return w;
  }
  function c(f, v) {
    return l.getCharCountIndicator(f, v) + 4;
  }
  function m(f, v) {
    let k = 0;
    return (
      f.forEach(function (w) {
        const j = c(w.mode, v);
        k += j + w.getBitsLength();
      }),
      k
    );
  }
  function d(f, v) {
    for (let k = 1; k <= 40; k++) if (m(f, k) <= e.getCapacity(k, v, l.MIXED)) return k;
  }
  ((e.from = function (v, k) {
    return a.isValid(v) ? parseInt(v, 10) : k;
  }),
    (e.getCapacity = function (v, k, w) {
      if (!a.isValid(v)) throw new Error('Invalid QR Code version');
      typeof w > 'u' && (w = l.BYTE);
      const j = t.getSymbolTotalCodewords(v),
        h = n.getTotalCodewordsCount(v, k),
        p = (j - h) * 8;
      if (w === l.MIXED) return p;
      const g = p - c(w, v);
      switch (w) {
        case l.NUMERIC:
          return Math.floor((g / 10) * 3);
        case l.ALPHANUMERIC:
          return Math.floor((g / 11) * 2);
        case l.KANJI:
          return Math.floor(g / 13);
        case l.BYTE:
        default:
          return Math.floor(g / 8);
      }
    }),
    (e.getBestVersionForData = function (v, k) {
      let w;
      const j = r.from(k, r.M);
      if (Array.isArray(v)) {
        if (v.length > 1) return d(v, j);
        if (v.length === 0) return 1;
        w = v[0];
      } else w = v;
      return u(w.mode, w.getLength(), j);
    }),
    (e.getEncodedBits = function (v) {
      if (!a.isValid(v) || v < 7) throw new Error('Invalid QR Code version');
      let k = v << 12;
      for (; t.getBCHDigit(k) - s >= 0;) k ^= o << (t.getBCHDigit(k) - s);
      return (v << 12) | k;
    }));
})(Fp);
var Up = {};
const Bi = Ae,
  Vp = 1335,
  J1 = 21522,
  Lc = Bi.getBCHDigit(Vp);
Up.getEncodedBits = function (t, n) {
  const r = (t.bit << 3) | n;
  let l = r << 10;
  for (; Bi.getBCHDigit(l) - Lc >= 0;) l ^= Vp << (Bi.getBCHDigit(l) - Lc);
  return ((r << 10) | l) ^ J1;
};
var Hp = {};
const G1 = Xt;
function Zn(e) {
  ((this.mode = G1.NUMERIC), (this.data = e.toString()));
}
Zn.getBitsLength = function (t) {
  return 10 * Math.floor(t / 3) + (t % 3 ? (t % 3) * 3 + 1 : 0);
};
Zn.prototype.getLength = function () {
  return this.data.length;
};
Zn.prototype.getBitsLength = function () {
  return Zn.getBitsLength(this.data.length);
};
Zn.prototype.write = function (t) {
  let n, r, l;
  for (n = 0; n + 3 <= this.data.length; n += 3)
    ((r = this.data.substr(n, 3)), (l = parseInt(r, 10)), t.put(l, 10));
  const a = this.data.length - n;
  a > 0 && ((r = this.data.substr(n)), (l = parseInt(r, 10)), t.put(l, a * 3 + 1));
};
var X1 = Zn;
const Z1 = Xt,
  Lo = [
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
    'G',
    'H',
    'I',
    'J',
    'K',
    'L',
    'M',
    'N',
    'O',
    'P',
    'Q',
    'R',
    'S',
    'T',
    'U',
    'V',
    'W',
    'X',
    'Y',
    'Z',
    ' ',
    '$',
    '%',
    '*',
    '+',
    '-',
    '.',
    '/',
    ':',
  ];
function er(e) {
  ((this.mode = Z1.ALPHANUMERIC), (this.data = e));
}
er.getBitsLength = function (t) {
  return 11 * Math.floor(t / 2) + 6 * (t % 2);
};
er.prototype.getLength = function () {
  return this.data.length;
};
er.prototype.getBitsLength = function () {
  return er.getBitsLength(this.data.length);
};
er.prototype.write = function (t) {
  let n;
  for (n = 0; n + 2 <= this.data.length; n += 2) {
    let r = Lo.indexOf(this.data[n]) * 45;
    ((r += Lo.indexOf(this.data[n + 1])), t.put(r, 11));
  }
  this.data.length % 2 && t.put(Lo.indexOf(this.data[n]), 6);
};
var ex = er;
const tx = Xt;
function tr(e) {
  ((this.mode = tx.BYTE),
    typeof e == 'string'
      ? (this.data = new TextEncoder().encode(e))
      : (this.data = new Uint8Array(e)));
}
tr.getBitsLength = function (t) {
  return t * 8;
};
tr.prototype.getLength = function () {
  return this.data.length;
};
tr.prototype.getBitsLength = function () {
  return tr.getBitsLength(this.data.length);
};
tr.prototype.write = function (e) {
  for (let t = 0, n = this.data.length; t < n; t++) e.put(this.data[t], 8);
};
var nx = tr;
const rx = Xt,
  lx = Ae;
function nr(e) {
  ((this.mode = rx.KANJI), (this.data = e));
}
nr.getBitsLength = function (t) {
  return t * 13;
};
nr.prototype.getLength = function () {
  return this.data.length;
};
nr.prototype.getBitsLength = function () {
  return nr.getBitsLength(this.data.length);
};
nr.prototype.write = function (e) {
  let t;
  for (t = 0; t < this.data.length; t++) {
    let n = lx.toSJIS(this.data[t]);
    if (n >= 33088 && n <= 40956) n -= 33088;
    else if (n >= 57408 && n <= 60351) n -= 49472;
    else
      throw new Error(
        'Invalid SJIS character: ' +
          this.data[t] +
          `
Make sure your charset is UTF-8`,
      );
    ((n = ((n >>> 8) & 255) * 192 + (n & 255)), e.put(n, 13));
  }
};
var ax = nr,
  Wp = { exports: {} };
(function (e) {
  var t = {
    single_source_shortest_paths: function (n, r, l) {
      var a = {},
        o = {};
      o[r] = 0;
      var s = t.PriorityQueue.make();
      s.push(r, 0);
      for (var u, c, m, d, f, v, k, w, j; !s.empty();) {
        ((u = s.pop()), (c = u.value), (d = u.cost), (f = n[c] || {}));
        for (m in f)
          f.hasOwnProperty(m) &&
            ((v = f[m]),
            (k = d + v),
            (w = o[m]),
            (j = typeof o[m] > 'u'),
            (j || w > k) && ((o[m] = k), s.push(m, k), (a[m] = c)));
      }
      if (typeof l < 'u' && typeof o[l] > 'u') {
        var h = ['Could not find a path from ', r, ' to ', l, '.'].join('');
        throw new Error(h);
      }
      return a;
    },
    extract_shortest_path_from_predecessor_list: function (n, r) {
      for (var l = [], a = r; a;) (l.push(a), n[a], (a = n[a]));
      return (l.reverse(), l);
    },
    find_path: function (n, r, l) {
      var a = t.single_source_shortest_paths(n, r, l);
      return t.extract_shortest_path_from_predecessor_list(a, l);
    },
    PriorityQueue: {
      make: function (n) {
        var r = t.PriorityQueue,
          l = {},
          a;
        n = n || {};
        for (a in r) r.hasOwnProperty(a) && (l[a] = r[a]);
        return ((l.queue = []), (l.sorter = n.sorter || r.default_sorter), l);
      },
      default_sorter: function (n, r) {
        return n.cost - r.cost;
      },
      push: function (n, r) {
        var l = { value: n, cost: r };
        (this.queue.push(l), this.queue.sort(this.sorter));
      },
      pop: function () {
        return this.queue.shift();
      },
      empty: function () {
        return this.queue.length === 0;
      },
    },
  };
  e.exports = t;
})(Wp);
var ox = Wp.exports;
(function (e) {
  const t = Xt,
    n = X1,
    r = ex,
    l = nx,
    a = ax,
    o = ht,
    s = Ae,
    u = ox;
  function c(h) {
    return unescape(encodeURIComponent(h)).length;
  }
  function m(h, p, g) {
    const y = [];
    let S;
    for (; (S = h.exec(g)) !== null;)
      y.push({ data: S[0], index: S.index, mode: p, length: S[0].length });
    return y;
  }
  function d(h) {
    const p = m(o.NUMERIC, t.NUMERIC, h),
      g = m(o.ALPHANUMERIC, t.ALPHANUMERIC, h);
    let y, S;
    return (
      s.isKanjiModeEnabled()
        ? ((y = m(o.BYTE, t.BYTE, h)), (S = m(o.KANJI, t.KANJI, h)))
        : ((y = m(o.BYTE_KANJI, t.BYTE, h)), (S = [])),
      p
        .concat(g, y, S)
        .sort(function (_, P) {
          return _.index - P.index;
        })
        .map(function (_) {
          return { data: _.data, mode: _.mode, length: _.length };
        })
    );
  }
  function f(h, p) {
    switch (p) {
      case t.NUMERIC:
        return n.getBitsLength(h);
      case t.ALPHANUMERIC:
        return r.getBitsLength(h);
      case t.KANJI:
        return a.getBitsLength(h);
      case t.BYTE:
        return l.getBitsLength(h);
    }
  }
  function v(h) {
    return h.reduce(function (p, g) {
      const y = p.length - 1 >= 0 ? p[p.length - 1] : null;
      return y && y.mode === g.mode ? ((p[p.length - 1].data += g.data), p) : (p.push(g), p);
    }, []);
  }
  function k(h) {
    const p = [];
    for (let g = 0; g < h.length; g++) {
      const y = h[g];
      switch (y.mode) {
        case t.NUMERIC:
          p.push([
            y,
            { data: y.data, mode: t.ALPHANUMERIC, length: y.length },
            { data: y.data, mode: t.BYTE, length: y.length },
          ]);
          break;
        case t.ALPHANUMERIC:
          p.push([y, { data: y.data, mode: t.BYTE, length: y.length }]);
          break;
        case t.KANJI:
          p.push([y, { data: y.data, mode: t.BYTE, length: c(y.data) }]);
          break;
        case t.BYTE:
          p.push([{ data: y.data, mode: t.BYTE, length: c(y.data) }]);
      }
    }
    return p;
  }
  function w(h, p) {
    const g = {},
      y = { start: {} };
    let S = ['start'];
    for (let N = 0; N < h.length; N++) {
      const _ = h[N],
        P = [];
      for (let I = 0; I < _.length; I++) {
        const T = _[I],
          b = '' + N + I;
        (P.push(b), (g[b] = { node: T, lastCount: 0 }), (y[b] = {}));
        for (let re = 0; re < S.length; re++) {
          const Z = S[re];
          g[Z] && g[Z].node.mode === T.mode
            ? ((y[Z][b] = f(g[Z].lastCount + T.length, T.mode) - f(g[Z].lastCount, T.mode)),
              (g[Z].lastCount += T.length))
            : (g[Z] && (g[Z].lastCount = T.length),
              (y[Z][b] = f(T.length, T.mode) + 4 + t.getCharCountIndicator(T.mode, p)));
        }
      }
      S = P;
    }
    for (let N = 0; N < S.length; N++) y[S[N]].end = 0;
    return { map: y, table: g };
  }
  function j(h, p) {
    let g;
    const y = t.getBestModeForData(h);
    if (((g = t.from(p, y)), g !== t.BYTE && g.bit < y.bit))
      throw new Error(
        '"' +
          h +
          '" cannot be encoded with mode ' +
          t.toString(g) +
          `.
 Suggested mode is: ` +
          t.toString(y),
      );
    switch ((g === t.KANJI && !s.isKanjiModeEnabled() && (g = t.BYTE), g)) {
      case t.NUMERIC:
        return new n(h);
      case t.ALPHANUMERIC:
        return new r(h);
      case t.KANJI:
        return new a(h);
      case t.BYTE:
        return new l(h);
    }
  }
  ((e.fromArray = function (p) {
    return p.reduce(function (g, y) {
      return (typeof y == 'string' ? g.push(j(y, null)) : y.data && g.push(j(y.data, y.mode)), g);
    }, []);
  }),
    (e.fromString = function (p, g) {
      const y = d(p, s.isKanjiModeEnabled()),
        S = k(y),
        N = w(S, g),
        _ = u.find_path(N.map, 'start', 'end'),
        P = [];
      for (let I = 1; I < _.length - 1; I++) P.push(N.table[_[I]].node);
      return e.fromArray(v(P));
    }),
    (e.rawSplit = function (p) {
      return e.fromArray(d(p, s.isKanjiModeEnabled()));
    }));
})(Hp);
const Za = Ae,
  Ro = Ja,
  ix = $1,
  sx = U1,
  ux = Ip,
  cx = Ap,
  Fi = Dp,
  $i = Ga,
  dx = H1,
  Sa = Fp,
  fx = Up,
  px = Xt,
  bo = Hp;
function hx(e, t) {
  const n = e.size,
    r = cx.getPositions(t);
  for (let l = 0; l < r.length; l++) {
    const a = r[l][0],
      o = r[l][1];
    for (let s = -1; s <= 7; s++)
      if (!(a + s <= -1 || n <= a + s))
        for (let u = -1; u <= 7; u++)
          o + u <= -1 ||
            n <= o + u ||
            ((s >= 0 && s <= 6 && (u === 0 || u === 6)) ||
            (u >= 0 && u <= 6 && (s === 0 || s === 6)) ||
            (s >= 2 && s <= 4 && u >= 2 && u <= 4)
              ? e.set(a + s, o + u, !0, !0)
              : e.set(a + s, o + u, !1, !0));
  }
}
function mx(e) {
  const t = e.size;
  for (let n = 8; n < t - 8; n++) {
    const r = n % 2 === 0;
    (e.set(n, 6, r, !0), e.set(6, n, r, !0));
  }
}
function gx(e, t) {
  const n = ux.getPositions(t);
  for (let r = 0; r < n.length; r++) {
    const l = n[r][0],
      a = n[r][1];
    for (let o = -2; o <= 2; o++)
      for (let s = -2; s <= 2; s++)
        o === -2 || o === 2 || s === -2 || s === 2 || (o === 0 && s === 0)
          ? e.set(l + o, a + s, !0, !0)
          : e.set(l + o, a + s, !1, !0);
  }
}
function vx(e, t) {
  const n = e.size,
    r = Sa.getEncodedBits(t);
  let l, a, o;
  for (let s = 0; s < 18; s++)
    ((l = Math.floor(s / 3)),
      (a = (s % 3) + n - 8 - 3),
      (o = ((r >> s) & 1) === 1),
      e.set(l, a, o, !0),
      e.set(a, l, o, !0));
}
function Mo(e, t, n) {
  const r = e.size,
    l = fx.getEncodedBits(t, n);
  let a, o;
  for (a = 0; a < 15; a++)
    ((o = ((l >> a) & 1) === 1),
      a < 6 ? e.set(a, 8, o, !0) : a < 8 ? e.set(a + 1, 8, o, !0) : e.set(r - 15 + a, 8, o, !0),
      a < 8
        ? e.set(8, r - a - 1, o, !0)
        : a < 9
          ? e.set(8, 15 - a - 1 + 1, o, !0)
          : e.set(8, 15 - a - 1, o, !0));
  e.set(r - 8, 8, 1, !0);
}
function yx(e, t) {
  const n = e.size;
  let r = -1,
    l = n - 1,
    a = 7,
    o = 0;
  for (let s = n - 1; s > 0; s -= 2)
    for (s === 6 && s--; ;) {
      for (let u = 0; u < 2; u++)
        if (!e.isReserved(l, s - u)) {
          let c = !1;
          (o < t.length && (c = ((t[o] >>> a) & 1) === 1),
            e.set(l, s - u, c),
            a--,
            a === -1 && (o++, (a = 7)));
        }
      if (((l += r), l < 0 || n <= l)) {
        ((l -= r), (r = -r));
        break;
      }
    }
}
function xx(e, t, n) {
  const r = new ix();
  n.forEach(function (u) {
    (r.put(u.mode.bit, 4), r.put(u.getLength(), px.getCharCountIndicator(u.mode, e)), u.write(r));
  });
  const l = Za.getSymbolTotalCodewords(e),
    a = $i.getTotalCodewordsCount(e, t),
    o = (l - a) * 8;
  for (r.getLengthInBits() + 4 <= o && r.put(0, 4); r.getLengthInBits() % 8 !== 0;) r.putBit(0);
  const s = (o - r.getLengthInBits()) / 8;
  for (let u = 0; u < s; u++) r.put(u % 2 ? 17 : 236, 8);
  return wx(r, e, t);
}
function wx(e, t, n) {
  const r = Za.getSymbolTotalCodewords(t),
    l = $i.getTotalCodewordsCount(t, n),
    a = r - l,
    o = $i.getBlocksCount(t, n),
    s = r % o,
    u = o - s,
    c = Math.floor(r / o),
    m = Math.floor(a / o),
    d = m + 1,
    f = c - m,
    v = new dx(f);
  let k = 0;
  const w = new Array(o),
    j = new Array(o);
  let h = 0;
  const p = new Uint8Array(e.buffer);
  for (let _ = 0; _ < o; _++) {
    const P = _ < u ? m : d;
    ((w[_] = p.slice(k, k + P)), (j[_] = v.encode(w[_])), (k += P), (h = Math.max(h, P)));
  }
  const g = new Uint8Array(r);
  let y = 0,
    S,
    N;
  for (S = 0; S < h; S++) for (N = 0; N < o; N++) S < w[N].length && (g[y++] = w[N][S]);
  for (S = 0; S < f; S++) for (N = 0; N < o; N++) g[y++] = j[N][S];
  return g;
}
function kx(e, t, n, r) {
  let l;
  if (Array.isArray(e)) l = bo.fromArray(e);
  else if (typeof e == 'string') {
    let c = t;
    if (!c) {
      const m = bo.rawSplit(e);
      c = Sa.getBestVersionForData(m, n);
    }
    l = bo.fromString(e, c || 40);
  } else throw new Error('Invalid data');
  const a = Sa.getBestVersionForData(l, n);
  if (!a) throw new Error('The amount of data is too big to be stored in a QR Code');
  if (!t) t = a;
  else if (t < a)
    throw new Error(
      `
The chosen QR Code version cannot contain this amount of data.
Minimum version required to store current data is: ` +
        a +
        `.
`,
    );
  const o = xx(t, n, l),
    s = Za.getSymbolSize(t),
    u = new sx(s);
  return (
    hx(u, t),
    mx(u),
    gx(u, t),
    Mo(u, n, 0),
    t >= 7 && vx(u, t),
    yx(u, o),
    isNaN(r) && (r = Fi.getBestMask(u, Mo.bind(null, u, n))),
    Fi.applyMask(r, u),
    Mo(u, n, r),
    { modules: u, version: t, errorCorrectionLevel: n, maskPattern: r, segments: l }
  );
}
Mp.create = function (t, n) {
  if (typeof t > 'u' || t === '') throw new Error('No input text');
  let r = Ro.M,
    l,
    a;
  return (
    typeof n < 'u' &&
      ((r = Ro.from(n.errorCorrectionLevel, Ro.M)),
      (l = Sa.from(n.version)),
      (a = Fi.from(n.maskPattern)),
      n.toSJISFunc && Za.setToSJISFunction(n.toSJISFunc)),
    kx(t, l, r, a)
  );
};
var Qp = {},
  nu = {};
(function (e) {
  function t(n) {
    if ((typeof n == 'number' && (n = n.toString()), typeof n != 'string'))
      throw new Error('Color should be defined as hex string');
    let r = n.slice().replace('#', '').split('');
    if (r.length < 3 || r.length === 5 || r.length > 8) throw new Error('Invalid hex color: ' + n);
    ((r.length === 3 || r.length === 4) &&
      (r = Array.prototype.concat.apply(
        [],
        r.map(function (a) {
          return [a, a];
        }),
      )),
      r.length === 6 && r.push('F', 'F'));
    const l = parseInt(r.join(''), 16);
    return {
      r: (l >> 24) & 255,
      g: (l >> 16) & 255,
      b: (l >> 8) & 255,
      a: l & 255,
      hex: '#' + r.slice(0, 6).join(''),
    };
  }
  ((e.getOptions = function (r) {
    (r || (r = {}), r.color || (r.color = {}));
    const l = typeof r.margin > 'u' || r.margin === null || r.margin < 0 ? 4 : r.margin,
      a = r.width && r.width >= 21 ? r.width : void 0,
      o = r.scale || 4;
    return {
      width: a,
      scale: a ? 4 : o,
      margin: l,
      color: { dark: t(r.color.dark || '#000000ff'), light: t(r.color.light || '#ffffffff') },
      type: r.type,
      rendererOpts: r.rendererOpts || {},
    };
  }),
    (e.getScale = function (r, l) {
      return l.width && l.width >= r + l.margin * 2 ? l.width / (r + l.margin * 2) : l.scale;
    }),
    (e.getImageWidth = function (r, l) {
      const a = e.getScale(r, l);
      return Math.floor((r + l.margin * 2) * a);
    }),
    (e.qrToImageData = function (r, l, a) {
      const o = l.modules.size,
        s = l.modules.data,
        u = e.getScale(o, a),
        c = Math.floor((o + a.margin * 2) * u),
        m = a.margin * u,
        d = [a.color.light, a.color.dark];
      for (let f = 0; f < c; f++)
        for (let v = 0; v < c; v++) {
          let k = (f * c + v) * 4,
            w = a.color.light;
          if (f >= m && v >= m && f < c - m && v < c - m) {
            const j = Math.floor((f - m) / u),
              h = Math.floor((v - m) / u);
            w = d[s[j * o + h] ? 1 : 0];
          }
          ((r[k++] = w.r), (r[k++] = w.g), (r[k++] = w.b), (r[k] = w.a));
        }
    }));
})(nu);
(function (e) {
  const t = nu;
  function n(l, a, o) {
    (l.clearRect(0, 0, a.width, a.height),
      a.style || (a.style = {}),
      (a.height = o),
      (a.width = o),
      (a.style.height = o + 'px'),
      (a.style.width = o + 'px'));
  }
  function r() {
    try {
      return document.createElement('canvas');
    } catch {
      throw new Error('You need to specify a canvas element');
    }
  }
  ((e.render = function (a, o, s) {
    let u = s,
      c = o;
    (typeof u > 'u' && (!o || !o.getContext) && ((u = o), (o = void 0)),
      o || (c = r()),
      (u = t.getOptions(u)));
    const m = t.getImageWidth(a.modules.size, u),
      d = c.getContext('2d'),
      f = d.createImageData(m, m);
    return (t.qrToImageData(f.data, a, u), n(d, c, m), d.putImageData(f, 0, 0), c);
  }),
    (e.renderToDataURL = function (a, o, s) {
      let u = s;
      (typeof u > 'u' && (!o || !o.getContext) && ((u = o), (o = void 0)), u || (u = {}));
      const c = e.render(a, o, u),
        m = u.type || 'image/png',
        d = u.rendererOpts || {};
      return c.toDataURL(m, d.quality);
    }));
})(Qp);
var Kp = {};
const jx = nu;
function Rc(e, t) {
  const n = e.a / 255,
    r = t + '="' + e.hex + '"';
  return n < 1 ? r + ' ' + t + '-opacity="' + n.toFixed(2).slice(1) + '"' : r;
}
function Oo(e, t, n) {
  let r = e + t;
  return (typeof n < 'u' && (r += ' ' + n), r);
}
function Sx(e, t, n) {
  let r = '',
    l = 0,
    a = !1,
    o = 0;
  for (let s = 0; s < e.length; s++) {
    const u = Math.floor(s % t),
      c = Math.floor(s / t);
    (!u && !a && (a = !0),
      e[s]
        ? (o++,
          (s > 0 && u > 0 && e[s - 1]) ||
            ((r += a ? Oo('M', u + n, 0.5 + c + n) : Oo('m', l, 0)), (l = 0), (a = !1)),
          (u + 1 < t && e[s + 1]) || ((r += Oo('h', o)), (o = 0)))
        : l++);
  }
  return r;
}
Kp.render = function (t, n, r) {
  const l = jx.getOptions(n),
    a = t.modules.size,
    o = t.modules.data,
    s = a + l.margin * 2,
    u = l.color.light.a
      ? '<path ' + Rc(l.color.light, 'fill') + ' d="M0 0h' + s + 'v' + s + 'H0z"/>'
      : '',
    c = '<path ' + Rc(l.color.dark, 'stroke') + ' d="' + Sx(o, a, l.margin) + '"/>',
    m = 'viewBox="0 0 ' + s + ' ' + s + '"',
    f =
      '<svg xmlns="http://www.w3.org/2000/svg" ' +
      (l.width ? 'width="' + l.width + '" height="' + l.width + '" ' : '') +
      m +
      ' shape-rendering="crispEdges">' +
      u +
      c +
      `</svg>
`;
  return (typeof r == 'function' && r(null, f), f);
};
const Nx = B1,
  Ui = Mp,
  qp = Qp,
  Cx = Kp;
function ru(e, t, n, r, l) {
  const a = [].slice.call(arguments, 1),
    o = a.length,
    s = typeof a[o - 1] == 'function';
  if (!s && !Nx()) throw new Error('Callback required as last argument');
  if (s) {
    if (o < 2) throw new Error('Too few arguments provided');
    o === 2
      ? ((l = n), (n = t), (t = r = void 0))
      : o === 3 &&
        (t.getContext && typeof l > 'u'
          ? ((l = r), (r = void 0))
          : ((l = r), (r = n), (n = t), (t = void 0)));
  } else {
    if (o < 1) throw new Error('Too few arguments provided');
    return (
      o === 1
        ? ((n = t), (t = r = void 0))
        : o === 2 && !t.getContext && ((r = n), (n = t), (t = void 0)),
      new Promise(function (u, c) {
        try {
          const m = Ui.create(n, r);
          u(e(m, t, r));
        } catch (m) {
          c(m);
        }
      })
    );
  }
  try {
    const u = Ui.create(n, r);
    l(null, e(u, t, r));
  } catch (u) {
    l(u);
  }
}
Xn.create = Ui.create;
Xn.toCanvas = ru.bind(null, qp.render);
Xn.toDataURL = ru.bind(null, qp.renderToDataURL);
Xn.toString = ru.bind(null, function (e, t, n) {
  return Cx.render(e, n);
});
const Ex = ne({
  type: 'store:qr-menu',
  settings: {
    logo: cl({ default: '/brand/logo-principal.png' }),
    catalogPath: Me({ default: '/catalog' }),
    title: E({ max: 60, default: '' }),
    subtitle: E({ max: 160 }),
    featuredLabel: E({ max: 40 }),
    hint: E({ max: 80 }),
    slogan: E({ max: 80 }),
    fileName: E({ max: 40, default: 'qrcode' }),
  },
});
function _x(e, t, n) {
  const r = e.trim().replace(/\/+$/, '');
  return t ? `${r}/produto/${encodeURIComponent(t)}` : `${r}${n}`;
}
function Px({ settings: e }) {
  var P, I;
  const t = Ua(),
    [n, r] = Dv(),
    { categories: l } = ul(),
    { store: a } = X(),
    [o, s] = x.useState(() => window.location.origin),
    [u, c] = x.useState(''),
    [m, d] = x.useState(''),
    [f, v] = x.useState(!0),
    [k, w] = x.useState(null),
    j = x.useMemo(() => l.flatMap((T) => T.products), [l]),
    h = n.get('produto') ?? '',
    p = j.find((T) => T.slug === h) ?? null,
    g = _x(o, h, e.catalogPath),
    y = g.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  x.useEffect(() => {
    let T = !0;
    return (
      v(!0),
      w(null),
      Promise.all([
        Xn.toDataURL(g, { width: 800, margin: 1, errorCorrectionLevel: 'H' }),
        Xn.toString(g, { type: 'svg', margin: 1, errorCorrectionLevel: 'H' }),
      ])
        .then(([b, re]) => {
          T && (d(b), c(re), v(!1));
        })
        .catch(() => {
          T && (w('Não foi possível gerar o código QR.'), v(!1));
        }),
      () => {
        T = !1;
      }
    );
  }, [g]);
  const S = (P = a == null ? void 0 : a.instagram) == null ? void 0 : P.replace(/^@/, ''),
    N = (I = a == null ? void 0 : a.whatsapp) == null ? void 0 : I.replace(/\D/g, ''),
    _ = [a == null ? void 0 : a.address, a == null ? void 0 : a.city].filter(Boolean).join(' · ');
  return i.jsxs('div', {
    className: 'qr-page',
    children: [
      i.jsxs('header', {
        className: 'qr-controls',
        role: 'toolbar',
        'aria-label': 'Ações do QR',
        children: [
          i.jsxs('button', {
            type: 'button',
            className: 'btn btn-ghost',
            onClick: () => (window.history.length > 1 ? t(-1) : t(e.catalogPath)),
            children: [i.jsx(t1, { size: 16, 'aria-hidden': 'true' }), ' Voltar'],
          }),
          i.jsxs('div', {
            className: 'qr-controls-mid',
            children: [
              i.jsx('label', {
                htmlFor: 'qr-produto',
                className: 'small',
                style: { fontWeight: 500 },
                children: 'Doce:',
              }),
              i.jsxs('select', {
                id: 'qr-produto',
                className: 'input',
                style: { height: 44, maxWidth: 260 },
                value: h,
                onChange: (T) => {
                  const b = new URLSearchParams(n);
                  (T.target.value ? b.set('produto', T.target.value) : b.delete('produto'),
                    r(b, { replace: !0 }));
                },
                children: [
                  i.jsx('option', { value: '', children: 'Cardápio completo' }),
                  j.map((T) => i.jsx('option', { value: T.slug, children: T.name }, T.id)),
                ],
              }),
              i.jsx('input', {
                className: 'input',
                style: { height: 44, maxWidth: 220 },
                'aria-label': 'Endereço base do link',
                value: o,
                onChange: (T) => s(T.target.value),
              }),
            ],
          }),
          i.jsxs('div', {
            style: { display: 'flex', gap: 8 },
            children: [
              m
                ? i.jsxs('a', {
                    href: m,
                    download: `${e.fileName}-${h || 'cardapio'}.png`,
                    className: 'btn btn-ghost',
                    children: [i.jsx(n1, { size: 16, 'aria-hidden': 'true' }), ' Baixar PNG'],
                  })
                : null,
              i.jsxs('button', {
                type: 'button',
                className: 'btn',
                onClick: () => window.print(),
                children: [i.jsx(l1, { size: 16, 'aria-hidden': 'true' }), ' Imprimir (A4)'],
              }),
            ],
          }),
        ],
      }),
      i.jsxs('div', {
        className: 'qr-stage',
        children: [
          i.jsx('article', {
            className: 'qr-sheet',
            'aria-label': 'Cardápio para impressão A4',
            children: i.jsxs('div', {
              className: 'qr-sheet-inner',
              children: [
                i.jsxs('div', {
                  style: { textAlign: 'center' },
                  children: [
                    i.jsx('img', {
                      src: e.logo,
                      alt: (a == null ? void 0 : a.name) ?? '',
                      className: 'qr-logo',
                    }),
                    a != null && a.tagline
                      ? i.jsx('p', { className: 'qr-tagline', children: a.tagline })
                      : null,
                    i.jsxs('div', {
                      className: 'qr-divider',
                      'aria-hidden': 'true',
                      children: [i.jsx('span', {}), '◆', i.jsx('span', {})],
                    }),
                  ],
                }),
                i.jsxs('div', {
                  style: { textAlign: 'center' },
                  children: [
                    p
                      ? i.jsxs('div', {
                          style: { marginBottom: 8 },
                          children: [
                            e.featuredLabel
                              ? i.jsx('span', { className: 'qr-chip', children: e.featuredLabel })
                              : null,
                            i.jsx('h2', {
                              className: 'display display-md',
                              style: { marginTop: 4 },
                              children: p.name,
                            }),
                            p.description
                              ? i.jsx('p', {
                                  className: 'small muted qr-desc',
                                  children: p.description,
                                })
                              : null,
                            i.jsx('p', {
                              className: 'display display-md',
                              style: { color: 'var(--caramel-800)', marginTop: 4 },
                              children: tl(p.basePriceCents),
                            }),
                          ],
                        })
                      : i.jsxs('div', {
                          style: { marginBottom: 8 },
                          children: [
                            i.jsx('h2', { className: 'display display-md', children: e.title }),
                            e.subtitle
                              ? i.jsx('p', { className: 'small muted', children: e.subtitle })
                              : null,
                          ],
                        }),
                    i.jsx('div', {
                      className: 'qr-box',
                      children: f
                        ? i.jsx('div', {
                            className: 'qr-placeholder',
                            children: 'Gerando QR Code…',
                          })
                        : k
                          ? i.jsx('div', {
                              className: 'qr-placeholder',
                              style: { color: 'var(--danger)' },
                              children: k,
                            })
                          : u
                            ? i.jsx('div', {
                                className: 'qr-svg',
                                dangerouslySetInnerHTML: { __html: u },
                              })
                            : null,
                    }),
                    i.jsx('p', { className: 'qr-url', children: y }),
                    e.hint ? i.jsx('p', { className: 'qr-hint', children: e.hint }) : null,
                  ],
                }),
                i.jsxs('div', {
                  style: { width: '100%' },
                  children: [
                    i.jsx('div', { className: 'ficha-hairline', style: { paddingTop: 12 } }),
                    i.jsxs('p', {
                      className: 'qr-contacts',
                      children: [
                        N
                          ? i.jsxs('span', {
                              children: [
                                i.jsx(Tp, { size: 12, 'aria-hidden': 'true' }),
                                ' WhatsApp: ',
                                N,
                              ],
                            })
                          : null,
                        S
                          ? i.jsxs('span', {
                              children: [i.jsx(Pp, { size: 12, 'aria-hidden': 'true' }), ' @', S],
                            })
                          : null,
                        _ ? i.jsx('span', { children: _ }) : null,
                      ],
                    }),
                    e.slogan ? i.jsx('p', { className: 'qr-slogan', children: e.slogan }) : null,
                  ],
                }),
              ],
            }),
          }),
          i.jsx('p', {
            className: 'qr-controls small muted',
            style: { marginTop: 24, textAlign: 'center' },
            children: i.jsx(ut, {
              to: e.catalogPath,
              style: { textDecoration: 'underline' },
              children: '← Voltar ao cardápio',
            }),
          }),
        ],
      }),
    ],
  });
}
const Tx = Object.freeze(
    Object.defineProperty({ __proto__: null, default: Px, schema: Ex }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  Lx = ne({
    type: 'store:showcase',
    settings: {
      eyebrow: E({ max: 60 }),
      title: E({ max: 80 }),
      lede: E({ max: 240 }),
      category: gp(),
      limit: Ka({ min: 1, max: 8, default: 4 }),
      numbered: et({ default: !0 }),
      cardCaption: E({ max: 30 }),
      cardCta: E({ max: 30 }),
      ctaLabel: E({ max: 40 }),
      ctaHref: Me(),
    },
    areas: { 'before-grid': { accepts: ['promo', 'info'], max: 1 } },
  });
function Rx({ settings: e }) {
  var a;
  const { categories: t, loading: n } = ul(),
    l = (
      e.category
        ? (((a = t.find((o) => o.slug === e.category)) == null ? void 0 : a.products) ?? [])
        : t.flatMap((o) => o.products)
    )
      .filter((o) => o.status === 'active')
      .slice(0, e.limit);
  return !n && l.length === 0
    ? null
    : i.jsxs('section', {
        className: 'container ficha-rule',
        style: { paddingBlock: '32px 64px' },
        children: [
          i.jsxs('div', {
            className: 'section-head',
            children: [
              e.eyebrow ? i.jsx('p', { className: 'eyebrow', children: e.eyebrow }) : null,
              e.title ? i.jsx('h2', { className: 'display display-lg', children: e.title }) : null,
              e.lede ? i.jsx('p', { className: 'lede', children: e.lede }) : null,
            ],
          }),
          i.jsx(Ue, { name: 'before-grid' }),
          n && l.length === 0
            ? i.jsx('div', {
                className: 'card-grid',
                'aria-busy': 'true',
                'aria-label': 'Carregando destaques',
                children: Array.from({ length: e.limit }, (o, s) =>
                  i.jsxs(
                    'div',
                    {
                      children: [
                        i.jsx(Un, { style: { aspectRatio: '1', width: '100%' } }),
                        i.jsxs('div', {
                          style: { paddingTop: 12, display: 'grid', gap: 8 },
                          children: [
                            i.jsx(Un, { style: { height: 12, width: '40%' } }),
                            i.jsx(Un, { style: { height: 22, width: '80%' } }),
                          ],
                        }),
                      ],
                    },
                    s,
                  ),
                ),
              })
            : i.jsx('ol', {
                className: 'card-grid',
                children: l.map((o, s) =>
                  i.jsx(
                    'li',
                    {
                      children: i.jsx(qs, {
                        product: o,
                        asChild: !0,
                        children: i.jsxs('a', {
                          className: 'card-link',
                          'aria-label': `${o.name}, ${tl(o.basePriceCents)}`,
                          children: [
                            i.jsx('div', {
                              className: 'print-frame',
                              children: i.jsx('div', {
                                className: 'card-frame',
                                children: i.jsx('div', {
                                  className: 'card-figure',
                                  children: i.jsx(Xs, { variant: o.figureVariant, title: o.name }),
                                }),
                              }),
                            }),
                            e.numbered
                              ? i.jsx('p', {
                                  className: 'ficha-num',
                                  style: { marginTop: 12 },
                                  children: bp(s + 1),
                                })
                              : e.cardCaption
                                ? i.jsx('p', { className: 'card-cat', children: e.cardCaption })
                                : null,
                            i.jsx('h3', { className: 'card-name', children: o.name }),
                            i.jsxs('div', {
                              className: 'card-foot',
                              children: [
                                i.jsx('span', {
                                  className: 'card-price',
                                  children: tl(o.basePriceCents),
                                }),
                                e.cardCta
                                  ? i.jsx('span', { className: 'card-cta', children: e.cardCta })
                                  : null,
                              ],
                            }),
                          ],
                        }),
                      }),
                    },
                    o.id,
                  ),
                ),
              }),
          e.ctaLabel && e.ctaHref
            ? i.jsx(ut, {
                to: e.ctaHref,
                className: 'btn',
                style: { marginTop: 40 },
                children: e.ctaLabel,
              })
            : null,
        ],
      });
}
const bx = Object.freeze(
    Object.defineProperty({ __proto__: null, default: Rx, schema: Lx }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  lu = { heart: r1, snowflake: Lp, truck: Rp, utensils: c1, shield: u1, bag: Gs },
  Yp = Object.keys(lu),
  Mx = ne({
    type: 'store:steps',
    settings: {
      eyebrow: E({ max: 60 }),
      title: E({ max: 80 }),
      lede: E({ max: 200 }),
      steps: vn(
        {
          icon: tt(Yp, { default: 'utensils' }),
          title: E({ max: 60, default: '' }),
          description: E({ max: 140, default: '' }),
        },
        { max: 5 },
      ),
      footnote: E({ max: 120 }),
    },
  });
function Ox({ settings: e }) {
  const { store: t } = X();
  return i.jsxs('section', {
    className: 'container ficha-rule',
    style: { paddingBlock: '32px 64px' },
    children: [
      i.jsxs('div', {
        className: 'section-head',
        children: [
          e.eyebrow ? i.jsx('p', { className: 'eyebrow', children: e.eyebrow }) : null,
          e.title ? i.jsx('h2', { className: 'display display-lg', children: e.title }) : null,
          e.lede ? i.jsx('p', { className: 'lede', children: e.lede }) : null,
        ],
      }),
      i.jsx('ol', {
        className: 'steps',
        children: (e.steps ?? []).map((n, r) => {
          const l = lu[n.icon];
          return i.jsxs(
            'li',
            {
              children: [
                i.jsxs('div', {
                  className: 'step-head',
                  children: [
                    i.jsx('span', { className: 'ficha-num', children: bp(r + 1) }),
                    i.jsx(l, { className: 'step-icon', 'aria-hidden': 'true' }),
                  ],
                }),
                i.jsx('h3', { children: n.title }),
                i.jsx('p', { children: n.description }),
              ],
            },
            n.title,
          );
        }),
      }),
      e.footnote
        ? i.jsx('p', {
            className: 'small muted',
            style: { marginTop: 32 },
            children: e.footnote.replaceAll('{city}', (t == null ? void 0 : t.city) ?? ''),
          })
        : null,
    ],
  });
}
const Ix = Object.freeze(
    Object.defineProperty({ __proto__: null, default: Ox, schema: Mx }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  Ax = ne({
    type: 'store:story',
    settings: {
      anchor: E({ max: 40, default: 'nossa-historia' }),
      eyebrow: E({ max: 60 }),
      title: E({ max: 60, default: '' }),
      titleEmphasis: E({ max: 60 }),
      text: E({ max: 600 }),
      image: cl(),
      imageAlt: E({ max: 160, default: '' }),
    },
    areas: { aside: { accepts: ['social-proof', 'badge', 'info'], max: 2 } },
  });
function Dx({ settings: e }) {
  return (
    x.useEffect(() => {
      var n;
      if (window.location.hash !== `#${e.anchor}`) return;
      const t = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      (n = document.getElementById(e.anchor)) == null ||
        n.scrollIntoView({ behavior: t ? 'instant' : 'smooth' });
    }, [e.anchor]),
    i.jsx('section', {
      id: e.anchor,
      className: 'ficha-rule',
      style: { scrollMarginTop: 120 },
      children: i.jsxs('div', {
        className: 'container',
        style: { paddingBlock: 64 },
        children: [
          e.eyebrow
            ? i.jsx('p', { className: 'eyebrow', style: { marginBottom: 24 }, children: e.eyebrow })
            : null,
          i.jsxs('div', {
            className: 'hero-grid',
            children: [
              e.image
                ? i.jsx('figure', {
                    className: 'hero-fig',
                    style: { order: 2 },
                    children: i.jsx('div', {
                      className: 'print-frame',
                      children: i.jsx('div', {
                        className: 'card-frame',
                        style: { aspectRatio: '4/3' },
                        children: i.jsx('img', {
                          src: e.image,
                          alt: e.imageAlt,
                          loading: 'lazy',
                          decoding: 'async',
                        }),
                      }),
                    }),
                  })
                : null,
              i.jsxs('div', {
                style: { order: 1 },
                children: [
                  i.jsxs('h2', {
                    className: 'display display-lg',
                    children: [
                      e.title,
                      e.titleEmphasis
                        ? i.jsxs(i.Fragment, {
                            children: [i.jsx('br', {}), i.jsx('em', { children: e.titleEmphasis })],
                          })
                        : null,
                    ],
                  }),
                  e.text ? i.jsx('p', { className: 'hero-sub', children: e.text }) : null,
                  i.jsx(Ue, { name: 'aside' }),
                ],
              }),
            ],
          }),
        ],
      }),
    })
  );
}
const zx = Object.freeze(
    Object.defineProperty({ __proto__: null, default: Dx, schema: Ax }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  Bx = ne({
    type: 'store:values',
    settings: {
      items: vn(
        {
          icon: tt(Yp, { default: 'heart' }),
          title: E({ max: 60, default: '' }),
          description: E({ max: 140, default: '' }),
        },
        { max: 4 },
      ),
    },
  });
function Fx({ settings: e }) {
  const t = e.items ?? [];
  return t.length === 0
    ? null
    : i.jsx('section', {
        className: 'container',
        style: { paddingBottom: 48 },
        children: i.jsx('dl', {
          className: 'values-grid ficha-rule',
          style: { paddingTop: 24, margin: 0 },
          children: t.map((n) => {
            const r = lu[n.icon];
            return i.jsxs(
              'div',
              {
                children: [
                  i.jsx(r, { className: 'value-icon', strokeWidth: 1.5, 'aria-hidden': 'true' }),
                  i.jsx('dt', { children: n.title }),
                  i.jsx('dd', { children: n.description }),
                ],
              },
              n.title,
            );
          }),
        }),
      });
}
const $x = Object.freeze(
    Object.defineProperty({ __proto__: null, default: Fx, schema: Bx }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  Ux = {
    templates: {
      catalog: {
        version: 1,
        page: 'catalog',
        sections: [
          {
            id: 'catalog',
            type: 'store:catalog-browser',
            settings: {
              eyebrow: 'Escolha o seu favorito',
              title: 'Nosso cardápio',
              lede: 'Para um mimo só seu ou para dividir à mesa.',
              searchLabel: 'Buscar no cardápio',
              searchPlaceholder: 'Qual sabor você procura?',
              allLabel: 'Todos os doces',
              itemSingular: 'doce',
              itemPlural: 'doces',
              emptyTitle: 'Novos doces vêm por aí',
              emptyText:
                'Estamos preparando o cardápio. Volte daqui a pouco para escolher o seu favorito.',
              noMatchTitle: 'Esse sabor ainda não apareceu',
              resetLabel: 'Ver todos os doces',
              bagLabel: 'Ver sacola',
            },
          },
        ],
      },
      home: {
        version: 1,
        page: 'home',
        sections: [
          {
            id: 'hero',
            type: 'store:hero',
            settings: {
              eyebrow: 'Feito à mão em {city}',
              title: 'Seu dia merece',
              titleEmphasis: 'um doce de verdade.',
              text: 'Pudim lisinho, sem furinho, calda dourada no ponto. Sacolé bem cremoso para o calor — feito à mão, para saborear sem pressa.',
              ctaLabel: 'Escolher meu doce',
              ctaHref: '/catalog',
              secondaryLabel: 'Nossa história',
              secondaryHref: '/#nossa-historia',
              image: '/images/hero-pudim-real.webp',
              imageAlt:
                'Confeiteira da Quero Pudim segurando um pudim embalado com a etiqueta da marca',
              figTitle: 'Receita de família',
              figSub: 'Cada um feito à mão, um por um.',
            },
          },
          {
            id: 'values',
            type: 'store:values',
            settings: {
              items: [
                {
                  icon: 'heart',
                  title: 'Feito à mão, de verdade',
                  description: 'Receita de família, sem atalho e sem pó.',
                },
                {
                  icon: 'snowflake',
                  title: 'Cremoso de verdade',
                  description: 'Pudim lisinho e sacolé que derrete na boca.',
                },
                {
                  icon: 'truck',
                  title: 'Pertinho de você',
                  description: 'Retire em Saquarema ou receba em casa.',
                },
              ],
            },
          },
          {
            id: 'featured',
            type: 'store:showcase',
            settings: {
              eyebrow: 'Ficha do dia',
              title: 'Direto da nossa cozinha',
              lede: 'Pudins e sacolés escolhidos a dedo para hoje.',
              limit: 4,
              numbered: !0,
              ctaLabel: 'Ver todos os doces',
              ctaHref: '/catalog',
            },
          },
          {
            id: 'kits',
            type: 'store:showcase',
            settings: {
              eyebrow: 'Kits e promoções especiais',
              title: 'Combos e kits personalizáveis',
              lede: 'Monte o kit com os sabores que você mais gosta — para a festa, o presente ou a sobremesa da semana.',
              category: 'kits',
              limit: 4,
              numbered: !1,
              cardCaption: 'Monte o seu',
              cardCta: 'Montar',
            },
          },
          {
            id: 'story',
            type: 'store:story',
            settings: {
              anchor: 'nossa-historia',
              eyebrow: 'Da nossa cozinha para você',
              title: 'O segredo é fazer',
              titleEmphasis: 'sem pressa.',
              text: 'Todo pudim sai da nossa cozinha em Saquarema, um por um, com receita de família e ingredientes escolhidos a dedo. Sem furinho, com calda dourada e aquele sabor de casa que a gente faz questão de manter.',
              image: '/images/confeiteira.jpg',
              imageAlt:
                'Retrato da confeiteira da Quero Pudim sorrindo com um pudim da marca nas mãos',
            },
          },
          {
            id: 'steps',
            type: 'store:steps',
            settings: {
              eyebrow: 'Como pedir',
              title: 'Do pedido ao primeiro gole',
              lede: 'Simples assim, em três passos.',
              steps: [
                {
                  icon: 'utensils',
                  title: 'Escolha seus doces',
                  description: 'Monte a sacola com pudins e sacolés.',
                },
                {
                  icon: 'shield',
                  title: 'Confirme o pedido',
                  description: 'Escolha entrega ou retirada na loja.',
                },
                {
                  icon: 'snowflake',
                  title: 'Receba geladinho',
                  description: 'A gente embala com cuidado e leva até você.',
                },
              ],
              footnote: 'Entrega e retirada em {city}.',
            },
          },
          {
            id: 'closing',
            type: 'store:closing',
            settings: {
              eyebrow: 'Feito à mão em Saquarema',
              title: 'Bateu a vontade?',
              text: 'O cardápio completo está logo ali.',
              ctaLabel: 'Escolher meus doces',
              ctaHref: '/catalog',
            },
          },
        ],
      },
      layout: {
        version: 1,
        page: 'layout',
        sections: [
          {
            id: 'header',
            type: 'store:header',
            settings: {
              storyAnchor: 'nossa-historia',
              links: [
                { label: 'Início', href: '/' },
                { label: 'Nossa história', href: '/#nossa-historia' },
                { label: 'Nosso cardápio', href: '/catalog' },
                { label: 'Meus pedidos', href: '/pedidos' },
              ],
            },
          },
          { id: 'content', type: 'sdk:page-content' },
          {
            id: 'footer',
            type: 'store:footer',
            settings: {
              eyebrow: 'Feito à mão em Saquarema',
              blurb: 'Pequenos momentos. Muito sabor.',
              contactsTitle: 'Vamos conversar?',
              links: [
                { label: 'Nosso cardápio', href: '/catalog' },
                { label: 'Meus pedidos', href: '/pedidos' },
              ],
              qrLabel: 'Cardápio QR Code',
              qrHref: '/qrcode',
            },
          },
        ],
      },
      'page:qrcode': {
        version: 1,
        page: 'page:qrcode',
        sections: [
          {
            id: 'qr',
            type: 'store:qr-menu',
            settings: {
              title: 'Cardápio & Pedidos Online',
              subtitle: 'Aponte a câmera do celular para conferir nossos doces e fazer seu pedido',
              featuredLabel: 'Destaque do cardápio',
              hint: 'ou acesse digitando em seu navegador',
              slogan: 'Feito à mão em Saquarema',
              fileName: 'qrcode-quero-pudim',
            },
          },
        ],
      },
      product: {
        version: 1,
        page: 'product',
        sections: [
          {
            id: 'purchase',
            type: 'sdk:purchase-panel',
            settings: {
              variant: 'editorial',
              addLabel: 'Adicionar à sacola',
              backLabel: 'Voltar ao cardápio',
              soldOutText: 'Esgotado hoje — deixe seu WhatsApp e a gente avisa quando voltar.',
            },
            blocks: {
              media: [{ id: 'figure', type: 'store:product-figure' }],
              'after-price': [
                {
                  id: 'perks',
                  type: 'store:product-perks',
                  settings: {
                    items: [
                      { icon: 'truck', text: 'Entrega em {city}' },
                      { icon: 'snowflake', text: 'Prontinho para servir' },
                    ],
                  },
                },
                { id: 'stock', type: 'sdk:stock-counter' },
              ],
              'after-cta': [{ id: 'notify', type: 'sdk:notify-me' }],
            },
          },
          {
            id: 'more',
            type: 'store:showcase',
            settings: {
              eyebrow: 'Para acompanhar',
              title: 'Você também vai gostar',
              limit: 4,
              numbered: !1,
              cardCta: 'Ver produto',
            },
          },
        ],
      },
    },
    tokens: null,
    source: 'repo',
  },
  Vx = Object.assign({
    '/sections/catalog.tsx': g1,
    '/sections/closing.tsx': x1,
    '/sections/footer.tsx': N1,
    '/sections/header.tsx': P1,
    '/sections/hero.tsx': R1,
    '/sections/product-figure.tsx': O1,
    '/sections/product-perks.tsx': z1,
    '/sections/qr-menu.tsx': Tx,
    '/sections/showcase.tsx': bx,
    '/sections/steps.tsx': Ix,
    '/sections/story.tsx': zx,
    '/sections/values.tsx': $x,
  }),
  Hx = { snapshot: Ux, sections: Vx },
  Wx = 'modulepreload',
  Qx = function (e) {
    return '/' + e;
  },
  bc = {},
  Kx = function (t, n, r) {
    let l = Promise.resolve();
    if (n && n.length > 0) {
      document.getElementsByTagName('link');
      const o = document.querySelector('meta[property=csp-nonce]'),
        s = (o == null ? void 0 : o.nonce) || (o == null ? void 0 : o.getAttribute('nonce'));
      l = Promise.allSettled(
        n.map((u) => {
          if (((u = Qx(u)), u in bc)) return;
          bc[u] = !0;
          const c = u.endsWith('.css'),
            m = c ? '[rel="stylesheet"]' : '';
          if (document.querySelector(`link[href="${u}"]${m}`)) return;
          const d = document.createElement('link');
          if (
            ((d.rel = c ? 'stylesheet' : Wx),
            c || (d.as = 'script'),
            (d.crossOrigin = ''),
            (d.href = u),
            s && d.setAttribute('nonce', s),
            document.head.appendChild(d),
            c)
          )
            return new Promise((f, v) => {
              (d.addEventListener('load', f),
                d.addEventListener('error', () => v(new Error(`Unable to preload CSS for ${u}`))));
            });
        }),
      );
    }
    function a(o) {
      const s = new Event('vite:preloadError', { cancelable: !0 });
      if (((s.payload = o), window.dispatchEvent(s), !s.defaultPrevented)) throw o;
    }
    return l.then((o) => {
      for (const s of o || []) s.status === 'rejected' && a(s.reason);
      return t().catch(a);
    });
  },
  qx = {
    contract: 2,
    tokens: {
      color: {
        bg: '#FCFBF8',
        surface: '#FFFFFF',
        text: '#1A1714',
        muted: '#77705F',
        accent: '#AC5E10',
        onAccent: '#FCFBF8',
        danger: '#B3372F',
        success: '#3D7A4F',
      },
      font: {
        display: '"Newsreader", Georgia, serif',
        body: '"Inter Tight", system-ui, -apple-system, sans-serif',
        mono: '"Geist Mono", ui-monospace, SFMono-Regular, monospace',
      },
      radius: { sm: '2px', md: '8px', lg: '12px' },
      space: { scale: ['4px', '8px', '12px', '16px', '24px', '32px', '48px'] },
      motion: { duration: '200ms', easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    },
    overrides: { 'system.Notice': () => Kx(() => import('./Notice-CZuulAzW.js'), []) },
    paths: { catalog: '/catalog' },
    redirects: { '/cart': '/sacola', '/meus-pedidos': '/pedidos' },
    budgets: 'default',
  },
  Jp = document.getElementById('root');
if (!Jp) throw new Error('missing #root');
Qf(Jp).render(
  i.jsx(x.StrictMode, {
    children: i.jsxs(ay, {
      config: qx,
      storefront: Hx,
      children: [i.jsx(Ky, {}), i.jsx(Rv, { children: i.jsx(G0, {}) })],
    }),
  }),
);
export { d1 as X, i as j };
