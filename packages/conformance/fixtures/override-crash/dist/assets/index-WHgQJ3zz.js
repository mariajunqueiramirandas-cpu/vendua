var Pf = Object.defineProperty;
var Tf = (e, t, n) =>
  t in e ? Pf(e, t, { enumerable: !0, configurable: !0, writable: !0, value: n }) : (e[t] = n);
var dn = (e, t, n) => Tf(e, typeof t != 'symbol' ? t + '' : t, n);
function Of(e, t) {
  for (var n = 0; n < t.length; n++) {
    const r = t[n];
    if (typeof r != 'string' && !Array.isArray(r)) {
      for (const l in r)
        if (l !== 'default' && !(l in e)) {
          const o = Object.getOwnPropertyDescriptor(r, l);
          o && Object.defineProperty(e, l, o.get ? o : { enumerable: !0, get: () => r[l] });
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
    for (const o of l)
      if (o.type === 'childList')
        for (const a of o.addedNodes) a.tagName === 'LINK' && a.rel === 'modulepreload' && r(a);
  }).observe(document, { childList: !0, subtree: !0 });
  function n(l) {
    const o = {};
    return (
      l.integrity && (o.integrity = l.integrity),
      l.referrerPolicy && (o.referrerPolicy = l.referrerPolicy),
      l.crossOrigin === 'use-credentials'
        ? (o.credentials = 'include')
        : l.crossOrigin === 'anonymous'
          ? (o.credentials = 'omit')
          : (o.credentials = 'same-origin'),
      o
    );
  }
  function r(l) {
    if (l.ep) return;
    l.ep = !0;
    const o = n(l);
    fetch(l.href, o);
  }
})();
function Lf(e) {
  return e && e.__esModule && Object.prototype.hasOwnProperty.call(e, 'default') ? e.default : e;
}
var Nu = { exports: {} },
  Jl = {},
  Cu = { exports: {} },
  D = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var Ar = Symbol.for('react.element'),
  Rf = Symbol.for('react.portal'),
  Df = Symbol.for('react.fragment'),
  zf = Symbol.for('react.strict_mode'),
  If = Symbol.for('react.profiler'),
  Mf = Symbol.for('react.provider'),
  Ff = Symbol.for('react.context'),
  $f = Symbol.for('react.forward_ref'),
  Af = Symbol.for('react.suspense'),
  Uf = Symbol.for('react.memo'),
  Bf = Symbol.for('react.lazy'),
  ts = Symbol.iterator;
function Vf(e) {
  return e === null || typeof e != 'object'
    ? null
    : ((e = (ts && e[ts]) || e['@@iterator']), typeof e == 'function' ? e : null);
}
var _u = {
    isMounted: function () {
      return !1;
    },
    enqueueForceUpdate: function () {},
    enqueueReplaceState: function () {},
    enqueueSetState: function () {},
  },
  Pu = Object.assign,
  Tu = {};
function Un(e, t, n) {
  ((this.props = e), (this.context = t), (this.refs = Tu), (this.updater = n || _u));
}
Un.prototype.isReactComponent = {};
Un.prototype.setState = function (e, t) {
  if (typeof e != 'object' && typeof e != 'function' && e != null)
    throw Error(
      'setState(...): takes an object of state variables to update or a function which returns an object of state variables.',
    );
  this.updater.enqueueSetState(this, e, t, 'setState');
};
Un.prototype.forceUpdate = function (e) {
  this.updater.enqueueForceUpdate(this, e, 'forceUpdate');
};
function Ou() {}
Ou.prototype = Un.prototype;
function Ga(e, t, n) {
  ((this.props = e), (this.context = t), (this.refs = Tu), (this.updater = n || _u));
}
var Xa = (Ga.prototype = new Ou());
Xa.constructor = Ga;
Pu(Xa, Un.prototype);
Xa.isPureReactComponent = !0;
var ns = Array.isArray,
  Lu = Object.prototype.hasOwnProperty,
  Ja = { current: null },
  Ru = { key: !0, ref: !0, __self: !0, __source: !0 };
function Du(e, t, n) {
  var r,
    l = {},
    o = null,
    a = null;
  if (t != null)
    for (r in (t.ref !== void 0 && (a = t.ref), t.key !== void 0 && (o = '' + t.key), t))
      Lu.call(t, r) && !Ru.hasOwnProperty(r) && (l[r] = t[r]);
  var i = arguments.length - 2;
  if (i === 1) l.children = n;
  else if (1 < i) {
    for (var u = Array(i), c = 0; c < i; c++) u[c] = arguments[c + 2];
    l.children = u;
  }
  if (e && e.defaultProps) for (r in ((i = e.defaultProps), i)) l[r] === void 0 && (l[r] = i[r]);
  return { $$typeof: Ar, type: e, key: o, ref: a, props: l, _owner: Ja.current };
}
function Wf(e, t) {
  return { $$typeof: Ar, type: e.type, key: t, ref: e.ref, props: e.props, _owner: e._owner };
}
function Za(e) {
  return typeof e == 'object' && e !== null && e.$$typeof === Ar;
}
function Hf(e) {
  var t = { '=': '=0', ':': '=2' };
  return (
    '$' +
    e.replace(/[=:]/g, function (n) {
      return t[n];
    })
  );
}
var rs = /\/+/g;
function ko(e, t) {
  return typeof e == 'object' && e !== null && e.key != null ? Hf('' + e.key) : t.toString(36);
}
function ml(e, t, n, r, l) {
  var o = typeof e;
  (o === 'undefined' || o === 'boolean') && (e = null);
  var a = !1;
  if (e === null) a = !0;
  else
    switch (o) {
      case 'string':
      case 'number':
        a = !0;
        break;
      case 'object':
        switch (e.$$typeof) {
          case Ar:
          case Rf:
            a = !0;
        }
    }
  if (a)
    return (
      (a = e),
      (l = l(a)),
      (e = r === '' ? '.' + ko(a, 0) : r),
      ns(l)
        ? ((n = ''),
          e != null && (n = e.replace(rs, '$&/') + '/'),
          ml(l, t, n, '', function (c) {
            return c;
          }))
        : l != null &&
          (Za(l) &&
            (l = Wf(
              l,
              n +
                (!l.key || (a && a.key === l.key) ? '' : ('' + l.key).replace(rs, '$&/') + '/') +
                e,
            )),
          t.push(l)),
      1
    );
  if (((a = 0), (r = r === '' ? '.' : r + ':'), ns(e)))
    for (var i = 0; i < e.length; i++) {
      o = e[i];
      var u = r + ko(o, i);
      a += ml(o, t, n, u, l);
    }
  else if (((u = Vf(e)), typeof u == 'function'))
    for (e = u.call(e), i = 0; !(o = e.next()).done;)
      ((o = o.value), (u = r + ko(o, i++)), (a += ml(o, t, n, u, l)));
  else if (o === 'object')
    throw (
      (t = String(e)),
      Error(
        'Objects are not valid as a React child (found: ' +
          (t === '[object Object]' ? 'object with keys {' + Object.keys(e).join(', ') + '}' : t) +
          '). If you meant to render a collection of children, use an array instead.',
      )
    );
  return a;
}
function Yr(e, t, n) {
  if (e == null) return e;
  var r = [],
    l = 0;
  return (
    ml(e, r, '', '', function (o) {
      return t.call(n, o, l++);
    }),
    r
  );
}
function Qf(e) {
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
var ve = { current: null },
  hl = { transition: null },
  Kf = { ReactCurrentDispatcher: ve, ReactCurrentBatchConfig: hl, ReactCurrentOwner: Ja };
function zu() {
  throw Error('act(...) is not supported in production builds of React.');
}
D.Children = {
  map: Yr,
  forEach: function (e, t, n) {
    Yr(
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
      Yr(e, function () {
        t++;
      }),
      t
    );
  },
  toArray: function (e) {
    return (
      Yr(e, function (t) {
        return t;
      }) || []
    );
  },
  only: function (e) {
    if (!Za(e))
      throw Error('React.Children.only expected to receive a single React element child.');
    return e;
  },
};
D.Component = Un;
D.Fragment = Df;
D.Profiler = If;
D.PureComponent = Ga;
D.StrictMode = zf;
D.Suspense = Af;
D.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = Kf;
D.act = zu;
D.cloneElement = function (e, t, n) {
  if (e == null)
    throw Error(
      'React.cloneElement(...): The argument must be a React element, but you passed ' + e + '.',
    );
  var r = Pu({}, e.props),
    l = e.key,
    o = e.ref,
    a = e._owner;
  if (t != null) {
    if (
      (t.ref !== void 0 && ((o = t.ref), (a = Ja.current)),
      t.key !== void 0 && (l = '' + t.key),
      e.type && e.type.defaultProps)
    )
      var i = e.type.defaultProps;
    for (u in t)
      Lu.call(t, u) &&
        !Ru.hasOwnProperty(u) &&
        (r[u] = t[u] === void 0 && i !== void 0 ? i[u] : t[u]);
  }
  var u = arguments.length - 2;
  if (u === 1) r.children = n;
  else if (1 < u) {
    i = Array(u);
    for (var c = 0; c < u; c++) i[c] = arguments[c + 2];
    r.children = i;
  }
  return { $$typeof: Ar, type: e.type, key: l, ref: o, props: r, _owner: a };
};
D.createContext = function (e) {
  return (
    (e = {
      $$typeof: Ff,
      _currentValue: e,
      _currentValue2: e,
      _threadCount: 0,
      Provider: null,
      Consumer: null,
      _defaultValue: null,
      _globalName: null,
    }),
    (e.Provider = { $$typeof: Mf, _context: e }),
    (e.Consumer = e)
  );
};
D.createElement = Du;
D.createFactory = function (e) {
  var t = Du.bind(null, e);
  return ((t.type = e), t);
};
D.createRef = function () {
  return { current: null };
};
D.forwardRef = function (e) {
  return { $$typeof: $f, render: e };
};
D.isValidElement = Za;
D.lazy = function (e) {
  return { $$typeof: Bf, _payload: { _status: -1, _result: e }, _init: Qf };
};
D.memo = function (e, t) {
  return { $$typeof: Uf, type: e, compare: t === void 0 ? null : t };
};
D.startTransition = function (e) {
  var t = hl.transition;
  hl.transition = {};
  try {
    e();
  } finally {
    hl.transition = t;
  }
};
D.unstable_act = zu;
D.useCallback = function (e, t) {
  return ve.current.useCallback(e, t);
};
D.useContext = function (e) {
  return ve.current.useContext(e);
};
D.useDebugValue = function () {};
D.useDeferredValue = function (e) {
  return ve.current.useDeferredValue(e);
};
D.useEffect = function (e, t) {
  return ve.current.useEffect(e, t);
};
D.useId = function () {
  return ve.current.useId();
};
D.useImperativeHandle = function (e, t, n) {
  return ve.current.useImperativeHandle(e, t, n);
};
D.useInsertionEffect = function (e, t) {
  return ve.current.useInsertionEffect(e, t);
};
D.useLayoutEffect = function (e, t) {
  return ve.current.useLayoutEffect(e, t);
};
D.useMemo = function (e, t) {
  return ve.current.useMemo(e, t);
};
D.useReducer = function (e, t, n) {
  return ve.current.useReducer(e, t, n);
};
D.useRef = function (e) {
  return ve.current.useRef(e);
};
D.useState = function (e) {
  return ve.current.useState(e);
};
D.useSyncExternalStore = function (e, t, n) {
  return ve.current.useSyncExternalStore(e, t, n);
};
D.useTransition = function () {
  return ve.current.useTransition();
};
D.version = '18.3.1';
Cu.exports = D;
var g = Cu.exports;
const bf = Lf(g),
  Yf = Of({ __proto__: null, default: bf }, [g]);
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var Gf = g,
  Xf = Symbol.for('react.element'),
  Jf = Symbol.for('react.fragment'),
  Zf = Object.prototype.hasOwnProperty,
  qf = Gf.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,
  ep = { key: !0, ref: !0, __self: !0, __source: !0 };
function Iu(e, t, n) {
  var r,
    l = {},
    o = null,
    a = null;
  (n !== void 0 && (o = '' + n),
    t.key !== void 0 && (o = '' + t.key),
    t.ref !== void 0 && (a = t.ref));
  for (r in t) Zf.call(t, r) && !ep.hasOwnProperty(r) && (l[r] = t[r]);
  if (e && e.defaultProps) for (r in ((t = e.defaultProps), t)) l[r] === void 0 && (l[r] = t[r]);
  return { $$typeof: Xf, type: e, key: o, ref: a, props: l, _owner: qf.current };
}
Jl.Fragment = Jf;
Jl.jsx = Iu;
Jl.jsxs = Iu;
Nu.exports = Jl;
var s = Nu.exports,
  Mu = { exports: {} },
  Oe = {},
  Fu = { exports: {} },
  $u = {};
/**
 * @license React
 * scheduler.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ (function (e) {
  function t(N, O) {
    var L = N.length;
    N.push(O);
    e: for (; 0 < L;) {
      var B = (L - 1) >>> 1,
        J = N[B];
      if (0 < l(J, O)) ((N[B] = O), (N[L] = J), (L = B));
      else break e;
    }
  }
  function n(N) {
    return N.length === 0 ? null : N[0];
  }
  function r(N) {
    if (N.length === 0) return null;
    var O = N[0],
      L = N.pop();
    if (L !== O) {
      N[0] = L;
      e: for (var B = 0, J = N.length, Vt = J >>> 1; B < Vt;) {
        var rt = 2 * (B + 1) - 1,
          Yn = N[rt],
          Re = rt + 1,
          cn = N[Re];
        if (0 > l(Yn, L))
          Re < J && 0 > l(cn, Yn)
            ? ((N[B] = cn), (N[Re] = L), (B = Re))
            : ((N[B] = Yn), (N[rt] = L), (B = rt));
        else if (Re < J && 0 > l(cn, L)) ((N[B] = cn), (N[Re] = L), (B = Re));
        else break e;
      }
    }
    return O;
  }
  function l(N, O) {
    var L = N.sortIndex - O.sortIndex;
    return L !== 0 ? L : N.id - O.id;
  }
  if (typeof performance == 'object' && typeof performance.now == 'function') {
    var o = performance;
    e.unstable_now = function () {
      return o.now();
    };
  } else {
    var a = Date,
      i = a.now();
    e.unstable_now = function () {
      return a.now() - i;
    };
  }
  var u = [],
    c = [],
    m = 1,
    d = null,
    f = 3,
    y = !1,
    S = !1,
    x = !1,
    E = typeof setTimeout == 'function' ? setTimeout : null,
    h = typeof clearTimeout == 'function' ? clearTimeout : null,
    p = typeof setImmediate < 'u' ? setImmediate : null;
  typeof navigator < 'u' &&
    navigator.scheduling !== void 0 &&
    navigator.scheduling.isInputPending !== void 0 &&
    navigator.scheduling.isInputPending.bind(navigator.scheduling);
  function v(N) {
    for (var O = n(c); O !== null;) {
      if (O.callback === null) r(c);
      else if (O.startTime <= N) (r(c), (O.sortIndex = O.expirationTime), t(u, O));
      else break;
      O = n(c);
    }
  }
  function k(N) {
    if (((x = !1), v(N), !S))
      if (n(u) !== null) ((S = !0), bn(j));
      else {
        var O = n(c);
        O !== null && un(k, O.startTime - N);
      }
  }
  function j(N, O) {
    ((S = !1), x && ((x = !1), h(_), (_ = -1)), (y = !0));
    var L = f;
    try {
      for (v(O), d = n(u); d !== null && (!(d.expirationTime > O) || (N && !I()));) {
        var B = d.callback;
        if (typeof B == 'function') {
          ((d.callback = null), (f = d.priorityLevel));
          var J = B(d.expirationTime <= O);
          ((O = e.unstable_now()),
            typeof J == 'function' ? (d.callback = J) : d === n(u) && r(u),
            v(O));
        } else r(u);
        d = n(u);
      }
      if (d !== null) var Vt = !0;
      else {
        var rt = n(c);
        (rt !== null && un(k, rt.startTime - O), (Vt = !1));
      }
      return Vt;
    } finally {
      ((d = null), (f = L), (y = !1));
    }
  }
  var P = !1,
    T = null,
    _ = -1,
    A = 5,
    R = -1;
  function I() {
    return !(e.unstable_now() - R < A);
  }
  function je() {
    if (T !== null) {
      var N = e.unstable_now();
      R = N;
      var O = !0;
      try {
        O = T(!0, N);
      } finally {
        O ? Ge() : ((P = !1), (T = null));
      }
    } else P = !1;
  }
  var Ge;
  if (typeof p == 'function')
    Ge = function () {
      p(je);
    };
  else if (typeof MessageChannel < 'u') {
    var Kn = new MessageChannel(),
      br = Kn.port2;
    ((Kn.port1.onmessage = je),
      (Ge = function () {
        br.postMessage(null);
      }));
  } else
    Ge = function () {
      E(je, 0);
    };
  function bn(N) {
    ((T = N), P || ((P = !0), Ge()));
  }
  function un(N, O) {
    _ = E(function () {
      N(e.unstable_now());
    }, O);
  }
  ((e.unstable_IdlePriority = 5),
    (e.unstable_ImmediatePriority = 1),
    (e.unstable_LowPriority = 4),
    (e.unstable_NormalPriority = 3),
    (e.unstable_Profiling = null),
    (e.unstable_UserBlockingPriority = 2),
    (e.unstable_cancelCallback = function (N) {
      N.callback = null;
    }),
    (e.unstable_continueExecution = function () {
      S || y || ((S = !0), bn(j));
    }),
    (e.unstable_forceFrameRate = function (N) {
      0 > N || 125 < N
        ? console.error(
            'forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported',
          )
        : (A = 0 < N ? Math.floor(1e3 / N) : 5);
    }),
    (e.unstable_getCurrentPriorityLevel = function () {
      return f;
    }),
    (e.unstable_getFirstCallbackNode = function () {
      return n(u);
    }),
    (e.unstable_next = function (N) {
      switch (f) {
        case 1:
        case 2:
        case 3:
          var O = 3;
          break;
        default:
          O = f;
      }
      var L = f;
      f = O;
      try {
        return N();
      } finally {
        f = L;
      }
    }),
    (e.unstable_pauseExecution = function () {}),
    (e.unstable_requestPaint = function () {}),
    (e.unstable_runWithPriority = function (N, O) {
      switch (N) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          N = 3;
      }
      var L = f;
      f = N;
      try {
        return O();
      } finally {
        f = L;
      }
    }),
    (e.unstable_scheduleCallback = function (N, O, L) {
      var B = e.unstable_now();
      switch (
        (typeof L == 'object' && L !== null
          ? ((L = L.delay), (L = typeof L == 'number' && 0 < L ? B + L : B))
          : (L = B),
        N)
      ) {
        case 1:
          var J = -1;
          break;
        case 2:
          J = 250;
          break;
        case 5:
          J = 1073741823;
          break;
        case 4:
          J = 1e4;
          break;
        default:
          J = 5e3;
      }
      return (
        (J = L + J),
        (N = {
          id: m++,
          callback: O,
          priorityLevel: N,
          startTime: L,
          expirationTime: J,
          sortIndex: -1,
        }),
        L > B
          ? ((N.sortIndex = L),
            t(c, N),
            n(u) === null && N === n(c) && (x ? (h(_), (_ = -1)) : (x = !0), un(k, L - B)))
          : ((N.sortIndex = J), t(u, N), S || y || ((S = !0), bn(j))),
        N
      );
    }),
    (e.unstable_shouldYield = I),
    (e.unstable_wrapCallback = function (N) {
      var O = f;
      return function () {
        var L = f;
        f = O;
        try {
          return N.apply(this, arguments);
        } finally {
          f = L;
        }
      };
    }));
})($u);
Fu.exports = $u;
var tp = Fu.exports;
/**
 * @license React
 * react-dom.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */ var np = g,
  Te = tp;
function w(e) {
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
var Au = new Set(),
  gr = {};
function on(e, t) {
  (Rn(e, t), Rn(e + 'Capture', t));
}
function Rn(e, t) {
  for (gr[e] = t, e = 0; e < t.length; e++) Au.add(t[e]);
}
var ct = !(
    typeof window > 'u' ||
    typeof window.document > 'u' ||
    typeof window.document.createElement > 'u'
  ),
  Yo = Object.prototype.hasOwnProperty,
  rp =
    /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,
  ls = {},
  os = {};
function lp(e) {
  return Yo.call(os, e) ? !0 : Yo.call(ls, e) ? !1 : rp.test(e) ? (os[e] = !0) : ((ls[e] = !0), !1);
}
function op(e, t, n, r) {
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
function ap(e, t, n, r) {
  if (t === null || typeof t > 'u' || op(e, t, n, r)) return !0;
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
function ge(e, t, n, r, l, o, a) {
  ((this.acceptsBooleans = t === 2 || t === 3 || t === 4),
    (this.attributeName = r),
    (this.attributeNamespace = l),
    (this.mustUseProperty = n),
    (this.propertyName = e),
    (this.type = t),
    (this.sanitizeURL = o),
    (this.removeEmptyString = a));
}
var se = {};
'children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style'
  .split(' ')
  .forEach(function (e) {
    se[e] = new ge(e, 0, !1, e, null, !1, !1);
  });
[
  ['acceptCharset', 'accept-charset'],
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['httpEquiv', 'http-equiv'],
].forEach(function (e) {
  var t = e[0];
  se[t] = new ge(t, 1, !1, e[1], null, !1, !1);
});
['contentEditable', 'draggable', 'spellCheck', 'value'].forEach(function (e) {
  se[e] = new ge(e, 2, !1, e.toLowerCase(), null, !1, !1);
});
['autoReverse', 'externalResourcesRequired', 'focusable', 'preserveAlpha'].forEach(function (e) {
  se[e] = new ge(e, 2, !1, e, null, !1, !1);
});
'allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope'
  .split(' ')
  .forEach(function (e) {
    se[e] = new ge(e, 3, !1, e.toLowerCase(), null, !1, !1);
  });
['checked', 'multiple', 'muted', 'selected'].forEach(function (e) {
  se[e] = new ge(e, 3, !0, e, null, !1, !1);
});
['capture', 'download'].forEach(function (e) {
  se[e] = new ge(e, 4, !1, e, null, !1, !1);
});
['cols', 'rows', 'size', 'span'].forEach(function (e) {
  se[e] = new ge(e, 6, !1, e, null, !1, !1);
});
['rowSpan', 'start'].forEach(function (e) {
  se[e] = new ge(e, 5, !1, e.toLowerCase(), null, !1, !1);
});
var qa = /[\-:]([a-z])/g;
function ei(e) {
  return e[1].toUpperCase();
}
'accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height'
  .split(' ')
  .forEach(function (e) {
    var t = e.replace(qa, ei);
    se[t] = new ge(t, 1, !1, e, null, !1, !1);
  });
'xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type'
  .split(' ')
  .forEach(function (e) {
    var t = e.replace(qa, ei);
    se[t] = new ge(t, 1, !1, e, 'http://www.w3.org/1999/xlink', !1, !1);
  });
['xml:base', 'xml:lang', 'xml:space'].forEach(function (e) {
  var t = e.replace(qa, ei);
  se[t] = new ge(t, 1, !1, e, 'http://www.w3.org/XML/1998/namespace', !1, !1);
});
['tabIndex', 'crossOrigin'].forEach(function (e) {
  se[e] = new ge(e, 1, !1, e.toLowerCase(), null, !1, !1);
});
se.xlinkHref = new ge('xlinkHref', 1, !1, 'xlink:href', 'http://www.w3.org/1999/xlink', !0, !1);
['src', 'href', 'action', 'formAction'].forEach(function (e) {
  se[e] = new ge(e, 1, !1, e.toLowerCase(), null, !0, !0);
});
function ti(e, t, n, r) {
  var l = se.hasOwnProperty(t) ? se[t] : null;
  (l !== null
    ? l.type !== 0
    : r || !(2 < t.length) || (t[0] !== 'o' && t[0] !== 'O') || (t[1] !== 'n' && t[1] !== 'N')) &&
    (ap(t, n, l, r) && (n = null),
    r || l === null
      ? lp(t) && (n === null ? e.removeAttribute(t) : e.setAttribute(t, '' + n))
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
var ht = np.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  Gr = Symbol.for('react.element'),
  mn = Symbol.for('react.portal'),
  hn = Symbol.for('react.fragment'),
  ni = Symbol.for('react.strict_mode'),
  Go = Symbol.for('react.profiler'),
  Uu = Symbol.for('react.provider'),
  Bu = Symbol.for('react.context'),
  ri = Symbol.for('react.forward_ref'),
  Xo = Symbol.for('react.suspense'),
  Jo = Symbol.for('react.suspense_list'),
  li = Symbol.for('react.memo'),
  kt = Symbol.for('react.lazy'),
  Vu = Symbol.for('react.offscreen'),
  as = Symbol.iterator;
function Gn(e) {
  return e === null || typeof e != 'object'
    ? null
    : ((e = (as && e[as]) || e['@@iterator']), typeof e == 'function' ? e : null);
}
var b = Object.assign,
  So;
function lr(e) {
  if (So === void 0)
    try {
      throw Error();
    } catch (n) {
      var t = n.stack.trim().match(/\n( *(at )?)/);
      So = (t && t[1]) || '';
    }
  return (
    `
` +
    So +
    e
  );
}
var wo = !1;
function Eo(e, t) {
  if (!e || wo) return '';
  wo = !0;
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
          o = r.stack.split(`
`),
          a = l.length - 1,
          i = o.length - 1;
        1 <= a && 0 <= i && l[a] !== o[i];
      )
        i--;
      for (; 1 <= a && 0 <= i; a--, i--)
        if (l[a] !== o[i]) {
          if (a !== 1 || i !== 1)
            do
              if ((a--, i--, 0 > i || l[a] !== o[i])) {
                var u =
                  `
` + l[a].replace(' at new ', ' at ');
                return (
                  e.displayName &&
                    u.includes('<anonymous>') &&
                    (u = u.replace('<anonymous>', e.displayName)),
                  u
                );
              }
            while (1 <= a && 0 <= i);
          break;
        }
    }
  } finally {
    ((wo = !1), (Error.prepareStackTrace = n));
  }
  return (e = e ? e.displayName || e.name : '') ? lr(e) : '';
}
function ip(e) {
  switch (e.tag) {
    case 5:
      return lr(e.type);
    case 16:
      return lr('Lazy');
    case 13:
      return lr('Suspense');
    case 19:
      return lr('SuspenseList');
    case 0:
    case 2:
    case 15:
      return ((e = Eo(e.type, !1)), e);
    case 11:
      return ((e = Eo(e.type.render, !1)), e);
    case 1:
      return ((e = Eo(e.type, !0)), e);
    default:
      return '';
  }
}
function Zo(e) {
  if (e == null) return null;
  if (typeof e == 'function') return e.displayName || e.name || null;
  if (typeof e == 'string') return e;
  switch (e) {
    case hn:
      return 'Fragment';
    case mn:
      return 'Portal';
    case Go:
      return 'Profiler';
    case ni:
      return 'StrictMode';
    case Xo:
      return 'Suspense';
    case Jo:
      return 'SuspenseList';
  }
  if (typeof e == 'object')
    switch (e.$$typeof) {
      case Bu:
        return (e.displayName || 'Context') + '.Consumer';
      case Uu:
        return (e._context.displayName || 'Context') + '.Provider';
      case ri:
        var t = e.render;
        return (
          (e = e.displayName),
          e ||
            ((e = t.displayName || t.name || ''),
            (e = e !== '' ? 'ForwardRef(' + e + ')' : 'ForwardRef')),
          e
        );
      case li:
        return ((t = e.displayName || null), t !== null ? t : Zo(e.type) || 'Memo');
      case kt:
        ((t = e._payload), (e = e._init));
        try {
          return Zo(e(t));
        } catch {}
    }
  return null;
}
function sp(e) {
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
      return Zo(t);
    case 8:
      return t === ni ? 'StrictMode' : 'Mode';
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
function It(e) {
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
function Wu(e) {
  var t = e.type;
  return (e = e.nodeName) && e.toLowerCase() === 'input' && (t === 'checkbox' || t === 'radio');
}
function up(e) {
  var t = Wu(e) ? 'checked' : 'value',
    n = Object.getOwnPropertyDescriptor(e.constructor.prototype, t),
    r = '' + e[t];
  if (
    !e.hasOwnProperty(t) &&
    typeof n < 'u' &&
    typeof n.get == 'function' &&
    typeof n.set == 'function'
  ) {
    var l = n.get,
      o = n.set;
    return (
      Object.defineProperty(e, t, {
        configurable: !0,
        get: function () {
          return l.call(this);
        },
        set: function (a) {
          ((r = '' + a), o.call(this, a));
        },
      }),
      Object.defineProperty(e, t, { enumerable: n.enumerable }),
      {
        getValue: function () {
          return r;
        },
        setValue: function (a) {
          r = '' + a;
        },
        stopTracking: function () {
          ((e._valueTracker = null), delete e[t]);
        },
      }
    );
  }
}
function Xr(e) {
  e._valueTracker || (e._valueTracker = up(e));
}
function Hu(e) {
  if (!e) return !1;
  var t = e._valueTracker;
  if (!t) return !0;
  var n = t.getValue(),
    r = '';
  return (
    e && (r = Wu(e) ? (e.checked ? 'true' : 'false') : e.value),
    (e = r),
    e !== n ? (t.setValue(e), !0) : !1
  );
}
function _l(e) {
  if (((e = e || (typeof document < 'u' ? document : void 0)), typeof e > 'u')) return null;
  try {
    return e.activeElement || e.body;
  } catch {
    return e.body;
  }
}
function qo(e, t) {
  var n = t.checked;
  return b({}, t, {
    defaultChecked: void 0,
    defaultValue: void 0,
    value: void 0,
    checked: n ?? e._wrapperState.initialChecked,
  });
}
function is(e, t) {
  var n = t.defaultValue == null ? '' : t.defaultValue,
    r = t.checked != null ? t.checked : t.defaultChecked;
  ((n = It(t.value != null ? t.value : n)),
    (e._wrapperState = {
      initialChecked: r,
      initialValue: n,
      controlled: t.type === 'checkbox' || t.type === 'radio' ? t.checked != null : t.value != null,
    }));
}
function Qu(e, t) {
  ((t = t.checked), t != null && ti(e, 'checked', t, !1));
}
function ea(e, t) {
  Qu(e, t);
  var n = It(t.value),
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
    ? ta(e, t.type, n)
    : t.hasOwnProperty('defaultValue') && ta(e, t.type, It(t.defaultValue)),
    t.checked == null && t.defaultChecked != null && (e.defaultChecked = !!t.defaultChecked));
}
function ss(e, t, n) {
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
function ta(e, t, n) {
  (t !== 'number' || _l(e.ownerDocument) !== e) &&
    (n == null
      ? (e.defaultValue = '' + e._wrapperState.initialValue)
      : e.defaultValue !== '' + n && (e.defaultValue = '' + n));
}
var or = Array.isArray;
function Cn(e, t, n, r) {
  if (((e = e.options), t)) {
    t = {};
    for (var l = 0; l < n.length; l++) t['$' + n[l]] = !0;
    for (n = 0; n < e.length; n++)
      ((l = t.hasOwnProperty('$' + e[n].value)),
        e[n].selected !== l && (e[n].selected = l),
        l && r && (e[n].defaultSelected = !0));
  } else {
    for (n = '' + It(n), t = null, l = 0; l < e.length; l++) {
      if (e[l].value === n) {
        ((e[l].selected = !0), r && (e[l].defaultSelected = !0));
        return;
      }
      t !== null || e[l].disabled || (t = e[l]);
    }
    t !== null && (t.selected = !0);
  }
}
function na(e, t) {
  if (t.dangerouslySetInnerHTML != null) throw Error(w(91));
  return b({}, t, {
    value: void 0,
    defaultValue: void 0,
    children: '' + e._wrapperState.initialValue,
  });
}
function us(e, t) {
  var n = t.value;
  if (n == null) {
    if (((n = t.children), (t = t.defaultValue), n != null)) {
      if (t != null) throw Error(w(92));
      if (or(n)) {
        if (1 < n.length) throw Error(w(93));
        n = n[0];
      }
      t = n;
    }
    (t == null && (t = ''), (n = t));
  }
  e._wrapperState = { initialValue: It(n) };
}
function Ku(e, t) {
  var n = It(t.value),
    r = It(t.defaultValue);
  (n != null &&
    ((n = '' + n),
    n !== e.value && (e.value = n),
    t.defaultValue == null && e.defaultValue !== n && (e.defaultValue = n)),
    r != null && (e.defaultValue = '' + r));
}
function cs(e) {
  var t = e.textContent;
  t === e._wrapperState.initialValue && t !== '' && t !== null && (e.value = t);
}
function bu(e) {
  switch (e) {
    case 'svg':
      return 'http://www.w3.org/2000/svg';
    case 'math':
      return 'http://www.w3.org/1998/Math/MathML';
    default:
      return 'http://www.w3.org/1999/xhtml';
  }
}
function ra(e, t) {
  return e == null || e === 'http://www.w3.org/1999/xhtml'
    ? bu(t)
    : e === 'http://www.w3.org/2000/svg' && t === 'foreignObject'
      ? 'http://www.w3.org/1999/xhtml'
      : e;
}
var Jr,
  Yu = (function (e) {
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
        Jr = Jr || document.createElement('div'),
          Jr.innerHTML = '<svg>' + t.valueOf().toString() + '</svg>',
          t = Jr.firstChild;
        e.firstChild;
      )
        e.removeChild(e.firstChild);
      for (; t.firstChild;) e.appendChild(t.firstChild);
    }
  });
function yr(e, t) {
  if (t) {
    var n = e.firstChild;
    if (n && n === e.lastChild && n.nodeType === 3) {
      n.nodeValue = t;
      return;
    }
  }
  e.textContent = t;
}
var sr = {
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
  cp = ['Webkit', 'ms', 'Moz', 'O'];
Object.keys(sr).forEach(function (e) {
  cp.forEach(function (t) {
    ((t = t + e.charAt(0).toUpperCase() + e.substring(1)), (sr[t] = sr[e]));
  });
});
function Gu(e, t, n) {
  return t == null || typeof t == 'boolean' || t === ''
    ? ''
    : n || typeof t != 'number' || t === 0 || (sr.hasOwnProperty(e) && sr[e])
      ? ('' + t).trim()
      : t + 'px';
}
function Xu(e, t) {
  e = e.style;
  for (var n in t)
    if (t.hasOwnProperty(n)) {
      var r = n.indexOf('--') === 0,
        l = Gu(n, t[n], r);
      (n === 'float' && (n = 'cssFloat'), r ? e.setProperty(n, l) : (e[n] = l));
    }
}
var dp = b(
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
function la(e, t) {
  if (t) {
    if (dp[e] && (t.children != null || t.dangerouslySetInnerHTML != null)) throw Error(w(137, e));
    if (t.dangerouslySetInnerHTML != null) {
      if (t.children != null) throw Error(w(60));
      if (typeof t.dangerouslySetInnerHTML != 'object' || !('__html' in t.dangerouslySetInnerHTML))
        throw Error(w(61));
    }
    if (t.style != null && typeof t.style != 'object') throw Error(w(62));
  }
}
function oa(e, t) {
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
var aa = null;
function oi(e) {
  return (
    (e = e.target || e.srcElement || window),
    e.correspondingUseElement && (e = e.correspondingUseElement),
    e.nodeType === 3 ? e.parentNode : e
  );
}
var ia = null,
  _n = null,
  Pn = null;
function ds(e) {
  if ((e = Vr(e))) {
    if (typeof ia != 'function') throw Error(w(280));
    var t = e.stateNode;
    t && ((t = no(t)), ia(e.stateNode, e.type, t));
  }
}
function Ju(e) {
  _n ? (Pn ? Pn.push(e) : (Pn = [e])) : (_n = e);
}
function Zu() {
  if (_n) {
    var e = _n,
      t = Pn;
    if (((Pn = _n = null), ds(e), t)) for (e = 0; e < t.length; e++) ds(t[e]);
  }
}
function qu(e, t) {
  return e(t);
}
function ec() {}
var jo = !1;
function tc(e, t, n) {
  if (jo) return e(t, n);
  jo = !0;
  try {
    return qu(e, t, n);
  } finally {
    ((jo = !1), (_n !== null || Pn !== null) && (ec(), Zu()));
  }
}
function xr(e, t) {
  var n = e.stateNode;
  if (n === null) return null;
  var r = no(n);
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
  if (n && typeof n != 'function') throw Error(w(231, t, typeof n));
  return n;
}
var sa = !1;
if (ct)
  try {
    var Xn = {};
    (Object.defineProperty(Xn, 'passive', {
      get: function () {
        sa = !0;
      },
    }),
      window.addEventListener('test', Xn, Xn),
      window.removeEventListener('test', Xn, Xn));
  } catch {
    sa = !1;
  }
function fp(e, t, n, r, l, o, a, i, u) {
  var c = Array.prototype.slice.call(arguments, 3);
  try {
    t.apply(n, c);
  } catch (m) {
    this.onError(m);
  }
}
var ur = !1,
  Pl = null,
  Tl = !1,
  ua = null,
  pp = {
    onError: function (e) {
      ((ur = !0), (Pl = e));
    },
  };
function mp(e, t, n, r, l, o, a, i, u) {
  ((ur = !1), (Pl = null), fp.apply(pp, arguments));
}
function hp(e, t, n, r, l, o, a, i, u) {
  if ((mp.apply(this, arguments), ur)) {
    if (ur) {
      var c = Pl;
      ((ur = !1), (Pl = null));
    } else throw Error(w(198));
    Tl || ((Tl = !0), (ua = c));
  }
}
function an(e) {
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
function nc(e) {
  if (e.tag === 13) {
    var t = e.memoizedState;
    if ((t === null && ((e = e.alternate), e !== null && (t = e.memoizedState)), t !== null))
      return t.dehydrated;
  }
  return null;
}
function fs(e) {
  if (an(e) !== e) throw Error(w(188));
}
function vp(e) {
  var t = e.alternate;
  if (!t) {
    if (((t = an(e)), t === null)) throw Error(w(188));
    return t !== e ? null : e;
  }
  for (var n = e, r = t; ;) {
    var l = n.return;
    if (l === null) break;
    var o = l.alternate;
    if (o === null) {
      if (((r = l.return), r !== null)) {
        n = r;
        continue;
      }
      break;
    }
    if (l.child === o.child) {
      for (o = l.child; o;) {
        if (o === n) return (fs(l), e);
        if (o === r) return (fs(l), t);
        o = o.sibling;
      }
      throw Error(w(188));
    }
    if (n.return !== r.return) ((n = l), (r = o));
    else {
      for (var a = !1, i = l.child; i;) {
        if (i === n) {
          ((a = !0), (n = l), (r = o));
          break;
        }
        if (i === r) {
          ((a = !0), (r = l), (n = o));
          break;
        }
        i = i.sibling;
      }
      if (!a) {
        for (i = o.child; i;) {
          if (i === n) {
            ((a = !0), (n = o), (r = l));
            break;
          }
          if (i === r) {
            ((a = !0), (r = o), (n = l));
            break;
          }
          i = i.sibling;
        }
        if (!a) throw Error(w(189));
      }
    }
    if (n.alternate !== r) throw Error(w(190));
  }
  if (n.tag !== 3) throw Error(w(188));
  return n.stateNode.current === n ? e : t;
}
function rc(e) {
  return ((e = vp(e)), e !== null ? lc(e) : null);
}
function lc(e) {
  if (e.tag === 5 || e.tag === 6) return e;
  for (e = e.child; e !== null;) {
    var t = lc(e);
    if (t !== null) return t;
    e = e.sibling;
  }
  return null;
}
var oc = Te.unstable_scheduleCallback,
  ps = Te.unstable_cancelCallback,
  gp = Te.unstable_shouldYield,
  yp = Te.unstable_requestPaint,
  X = Te.unstable_now,
  xp = Te.unstable_getCurrentPriorityLevel,
  ai = Te.unstable_ImmediatePriority,
  ac = Te.unstable_UserBlockingPriority,
  Ol = Te.unstable_NormalPriority,
  kp = Te.unstable_LowPriority,
  ic = Te.unstable_IdlePriority,
  Zl = null,
  et = null;
function Sp(e) {
  if (et && typeof et.onCommitFiberRoot == 'function')
    try {
      et.onCommitFiberRoot(Zl, e, void 0, (e.current.flags & 128) === 128);
    } catch {}
}
var Qe = Math.clz32 ? Math.clz32 : jp,
  wp = Math.log,
  Ep = Math.LN2;
function jp(e) {
  return ((e >>>= 0), e === 0 ? 32 : (31 - ((wp(e) / Ep) | 0)) | 0);
}
var Zr = 64,
  qr = 4194304;
function ar(e) {
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
function Ll(e, t) {
  var n = e.pendingLanes;
  if (n === 0) return 0;
  var r = 0,
    l = e.suspendedLanes,
    o = e.pingedLanes,
    a = n & 268435455;
  if (a !== 0) {
    var i = a & ~l;
    i !== 0 ? (r = ar(i)) : ((o &= a), o !== 0 && (r = ar(o)));
  } else ((a = n & ~l), a !== 0 ? (r = ar(a)) : o !== 0 && (r = ar(o)));
  if (r === 0) return 0;
  if (
    t !== 0 &&
    t !== r &&
    !(t & l) &&
    ((l = r & -r), (o = t & -t), l >= o || (l === 16 && (o & 4194240) !== 0))
  )
    return t;
  if ((r & 4 && (r |= n & 16), (t = e.entangledLanes), t !== 0))
    for (e = e.entanglements, t &= r; 0 < t;)
      ((n = 31 - Qe(t)), (l = 1 << n), (r |= e[n]), (t &= ~l));
  return r;
}
function Np(e, t) {
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
function Cp(e, t) {
  for (
    var n = e.suspendedLanes, r = e.pingedLanes, l = e.expirationTimes, o = e.pendingLanes;
    0 < o;
  ) {
    var a = 31 - Qe(o),
      i = 1 << a,
      u = l[a];
    (u === -1 ? (!(i & n) || i & r) && (l[a] = Np(i, t)) : u <= t && (e.expiredLanes |= i),
      (o &= ~i));
  }
}
function ca(e) {
  return ((e = e.pendingLanes & -1073741825), e !== 0 ? e : e & 1073741824 ? 1073741824 : 0);
}
function sc() {
  var e = Zr;
  return ((Zr <<= 1), !(Zr & 4194240) && (Zr = 64), e);
}
function No(e) {
  for (var t = [], n = 0; 31 > n; n++) t.push(e);
  return t;
}
function Ur(e, t, n) {
  ((e.pendingLanes |= t),
    t !== 536870912 && ((e.suspendedLanes = 0), (e.pingedLanes = 0)),
    (e = e.eventTimes),
    (t = 31 - Qe(t)),
    (e[t] = n));
}
function _p(e, t) {
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
    var l = 31 - Qe(n),
      o = 1 << l;
    ((t[l] = 0), (r[l] = -1), (e[l] = -1), (n &= ~o));
  }
}
function ii(e, t) {
  var n = (e.entangledLanes |= t);
  for (e = e.entanglements; n;) {
    var r = 31 - Qe(n),
      l = 1 << r;
    ((l & t) | (e[r] & t) && (e[r] |= t), (n &= ~l));
  }
}
var M = 0;
function uc(e) {
  return ((e &= -e), 1 < e ? (4 < e ? (e & 268435455 ? 16 : 536870912) : 4) : 1);
}
var cc,
  si,
  dc,
  fc,
  pc,
  da = !1,
  el = [],
  _t = null,
  Pt = null,
  Tt = null,
  kr = new Map(),
  Sr = new Map(),
  wt = [],
  Pp =
    'mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit'.split(
      ' ',
    );
function ms(e, t) {
  switch (e) {
    case 'focusin':
    case 'focusout':
      _t = null;
      break;
    case 'dragenter':
    case 'dragleave':
      Pt = null;
      break;
    case 'mouseover':
    case 'mouseout':
      Tt = null;
      break;
    case 'pointerover':
    case 'pointerout':
      kr.delete(t.pointerId);
      break;
    case 'gotpointercapture':
    case 'lostpointercapture':
      Sr.delete(t.pointerId);
  }
}
function Jn(e, t, n, r, l, o) {
  return e === null || e.nativeEvent !== o
    ? ((e = {
        blockedOn: t,
        domEventName: n,
        eventSystemFlags: r,
        nativeEvent: o,
        targetContainers: [l],
      }),
      t !== null && ((t = Vr(t)), t !== null && si(t)),
      e)
    : ((e.eventSystemFlags |= r),
      (t = e.targetContainers),
      l !== null && t.indexOf(l) === -1 && t.push(l),
      e);
}
function Tp(e, t, n, r, l) {
  switch (t) {
    case 'focusin':
      return ((_t = Jn(_t, e, t, n, r, l)), !0);
    case 'dragenter':
      return ((Pt = Jn(Pt, e, t, n, r, l)), !0);
    case 'mouseover':
      return ((Tt = Jn(Tt, e, t, n, r, l)), !0);
    case 'pointerover':
      var o = l.pointerId;
      return (kr.set(o, Jn(kr.get(o) || null, e, t, n, r, l)), !0);
    case 'gotpointercapture':
      return ((o = l.pointerId), Sr.set(o, Jn(Sr.get(o) || null, e, t, n, r, l)), !0);
  }
  return !1;
}
function mc(e) {
  var t = Kt(e.target);
  if (t !== null) {
    var n = an(t);
    if (n !== null) {
      if (((t = n.tag), t === 13)) {
        if (((t = nc(n)), t !== null)) {
          ((e.blockedOn = t),
            pc(e.priority, function () {
              dc(n);
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
function vl(e) {
  if (e.blockedOn !== null) return !1;
  for (var t = e.targetContainers; 0 < t.length;) {
    var n = fa(e.domEventName, e.eventSystemFlags, t[0], e.nativeEvent);
    if (n === null) {
      n = e.nativeEvent;
      var r = new n.constructor(n.type, n);
      ((aa = r), n.target.dispatchEvent(r), (aa = null));
    } else return ((t = Vr(n)), t !== null && si(t), (e.blockedOn = n), !1);
    t.shift();
  }
  return !0;
}
function hs(e, t, n) {
  vl(e) && n.delete(t);
}
function Op() {
  ((da = !1),
    _t !== null && vl(_t) && (_t = null),
    Pt !== null && vl(Pt) && (Pt = null),
    Tt !== null && vl(Tt) && (Tt = null),
    kr.forEach(hs),
    Sr.forEach(hs));
}
function Zn(e, t) {
  e.blockedOn === t &&
    ((e.blockedOn = null),
    da || ((da = !0), Te.unstable_scheduleCallback(Te.unstable_NormalPriority, Op)));
}
function wr(e) {
  function t(l) {
    return Zn(l, e);
  }
  if (0 < el.length) {
    Zn(el[0], e);
    for (var n = 1; n < el.length; n++) {
      var r = el[n];
      r.blockedOn === e && (r.blockedOn = null);
    }
  }
  for (
    _t !== null && Zn(_t, e),
      Pt !== null && Zn(Pt, e),
      Tt !== null && Zn(Tt, e),
      kr.forEach(t),
      Sr.forEach(t),
      n = 0;
    n < wt.length;
    n++
  )
    ((r = wt[n]), r.blockedOn === e && (r.blockedOn = null));
  for (; 0 < wt.length && ((n = wt[0]), n.blockedOn === null);)
    (mc(n), n.blockedOn === null && wt.shift());
}
var Tn = ht.ReactCurrentBatchConfig,
  Rl = !0;
function Lp(e, t, n, r) {
  var l = M,
    o = Tn.transition;
  Tn.transition = null;
  try {
    ((M = 1), ui(e, t, n, r));
  } finally {
    ((M = l), (Tn.transition = o));
  }
}
function Rp(e, t, n, r) {
  var l = M,
    o = Tn.transition;
  Tn.transition = null;
  try {
    ((M = 4), ui(e, t, n, r));
  } finally {
    ((M = l), (Tn.transition = o));
  }
}
function ui(e, t, n, r) {
  if (Rl) {
    var l = fa(e, t, n, r);
    if (l === null) (Io(e, t, r, Dl, n), ms(e, r));
    else if (Tp(l, e, t, n, r)) r.stopPropagation();
    else if ((ms(e, r), t & 4 && -1 < Pp.indexOf(e))) {
      for (; l !== null;) {
        var o = Vr(l);
        if ((o !== null && cc(o), (o = fa(e, t, n, r)), o === null && Io(e, t, r, Dl, n), o === l))
          break;
        l = o;
      }
      l !== null && r.stopPropagation();
    } else Io(e, t, r, null, n);
  }
}
var Dl = null;
function fa(e, t, n, r) {
  if (((Dl = null), (e = oi(r)), (e = Kt(e)), e !== null))
    if (((t = an(e)), t === null)) e = null;
    else if (((n = t.tag), n === 13)) {
      if (((e = nc(t)), e !== null)) return e;
      e = null;
    } else if (n === 3) {
      if (t.stateNode.current.memoizedState.isDehydrated)
        return t.tag === 3 ? t.stateNode.containerInfo : null;
      e = null;
    } else t !== e && (e = null);
  return ((Dl = e), null);
}
function hc(e) {
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
      switch (xp()) {
        case ai:
          return 1;
        case ac:
          return 4;
        case Ol:
        case kp:
          return 16;
        case ic:
          return 536870912;
        default:
          return 16;
      }
    default:
      return 16;
  }
}
var jt = null,
  ci = null,
  gl = null;
function vc() {
  if (gl) return gl;
  var e,
    t = ci,
    n = t.length,
    r,
    l = 'value' in jt ? jt.value : jt.textContent,
    o = l.length;
  for (e = 0; e < n && t[e] === l[e]; e++);
  var a = n - e;
  for (r = 1; r <= a && t[n - r] === l[o - r]; r++);
  return (gl = l.slice(e, 1 < r ? 1 - r : void 0));
}
function yl(e) {
  var t = e.keyCode;
  return (
    'charCode' in e ? ((e = e.charCode), e === 0 && t === 13 && (e = 13)) : (e = t),
    e === 10 && (e = 13),
    32 <= e || e === 13 ? e : 0
  );
}
function tl() {
  return !0;
}
function vs() {
  return !1;
}
function Le(e) {
  function t(n, r, l, o, a) {
    ((this._reactName = n),
      (this._targetInst = l),
      (this.type = r),
      (this.nativeEvent = o),
      (this.target = a),
      (this.currentTarget = null));
    for (var i in e) e.hasOwnProperty(i) && ((n = e[i]), (this[i] = n ? n(o) : o[i]));
    return (
      (this.isDefaultPrevented = (
        o.defaultPrevented != null ? o.defaultPrevented : o.returnValue === !1
      )
        ? tl
        : vs),
      (this.isPropagationStopped = vs),
      this
    );
  }
  return (
    b(t.prototype, {
      preventDefault: function () {
        this.defaultPrevented = !0;
        var n = this.nativeEvent;
        n &&
          (n.preventDefault
            ? n.preventDefault()
            : typeof n.returnValue != 'unknown' && (n.returnValue = !1),
          (this.isDefaultPrevented = tl));
      },
      stopPropagation: function () {
        var n = this.nativeEvent;
        n &&
          (n.stopPropagation
            ? n.stopPropagation()
            : typeof n.cancelBubble != 'unknown' && (n.cancelBubble = !0),
          (this.isPropagationStopped = tl));
      },
      persist: function () {},
      isPersistent: tl,
    }),
    t
  );
}
var Bn = {
    eventPhase: 0,
    bubbles: 0,
    cancelable: 0,
    timeStamp: function (e) {
      return e.timeStamp || Date.now();
    },
    defaultPrevented: 0,
    isTrusted: 0,
  },
  di = Le(Bn),
  Br = b({}, Bn, { view: 0, detail: 0 }),
  Dp = Le(Br),
  Co,
  _o,
  qn,
  ql = b({}, Br, {
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
    getModifierState: fi,
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
        : (e !== qn &&
            (qn && e.type === 'mousemove'
              ? ((Co = e.screenX - qn.screenX), (_o = e.screenY - qn.screenY))
              : (_o = Co = 0),
            (qn = e)),
          Co);
    },
    movementY: function (e) {
      return 'movementY' in e ? e.movementY : _o;
    },
  }),
  gs = Le(ql),
  zp = b({}, ql, { dataTransfer: 0 }),
  Ip = Le(zp),
  Mp = b({}, Br, { relatedTarget: 0 }),
  Po = Le(Mp),
  Fp = b({}, Bn, { animationName: 0, elapsedTime: 0, pseudoElement: 0 }),
  $p = Le(Fp),
  Ap = b({}, Bn, {
    clipboardData: function (e) {
      return 'clipboardData' in e ? e.clipboardData : window.clipboardData;
    },
  }),
  Up = Le(Ap),
  Bp = b({}, Bn, { data: 0 }),
  ys = Le(Bp),
  Vp = {
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
  Wp = {
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
  Hp = { Alt: 'altKey', Control: 'ctrlKey', Meta: 'metaKey', Shift: 'shiftKey' };
function Qp(e) {
  var t = this.nativeEvent;
  return t.getModifierState ? t.getModifierState(e) : (e = Hp[e]) ? !!t[e] : !1;
}
function fi() {
  return Qp;
}
var Kp = b({}, Br, {
    key: function (e) {
      if (e.key) {
        var t = Vp[e.key] || e.key;
        if (t !== 'Unidentified') return t;
      }
      return e.type === 'keypress'
        ? ((e = yl(e)), e === 13 ? 'Enter' : String.fromCharCode(e))
        : e.type === 'keydown' || e.type === 'keyup'
          ? Wp[e.keyCode] || 'Unidentified'
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
    getModifierState: fi,
    charCode: function (e) {
      return e.type === 'keypress' ? yl(e) : 0;
    },
    keyCode: function (e) {
      return e.type === 'keydown' || e.type === 'keyup' ? e.keyCode : 0;
    },
    which: function (e) {
      return e.type === 'keypress'
        ? yl(e)
        : e.type === 'keydown' || e.type === 'keyup'
          ? e.keyCode
          : 0;
    },
  }),
  bp = Le(Kp),
  Yp = b({}, ql, {
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
  xs = Le(Yp),
  Gp = b({}, Br, {
    touches: 0,
    targetTouches: 0,
    changedTouches: 0,
    altKey: 0,
    metaKey: 0,
    ctrlKey: 0,
    shiftKey: 0,
    getModifierState: fi,
  }),
  Xp = Le(Gp),
  Jp = b({}, Bn, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 }),
  Zp = Le(Jp),
  qp = b({}, ql, {
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
  em = Le(qp),
  tm = [9, 13, 27, 32],
  pi = ct && 'CompositionEvent' in window,
  cr = null;
ct && 'documentMode' in document && (cr = document.documentMode);
var nm = ct && 'TextEvent' in window && !cr,
  gc = ct && (!pi || (cr && 8 < cr && 11 >= cr)),
  ks = ' ',
  Ss = !1;
function yc(e, t) {
  switch (e) {
    case 'keyup':
      return tm.indexOf(t.keyCode) !== -1;
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
function xc(e) {
  return ((e = e.detail), typeof e == 'object' && 'data' in e ? e.data : null);
}
var vn = !1;
function rm(e, t) {
  switch (e) {
    case 'compositionend':
      return xc(t);
    case 'keypress':
      return t.which !== 32 ? null : ((Ss = !0), ks);
    case 'textInput':
      return ((e = t.data), e === ks && Ss ? null : e);
    default:
      return null;
  }
}
function lm(e, t) {
  if (vn)
    return e === 'compositionend' || (!pi && yc(e, t))
      ? ((e = vc()), (gl = ci = jt = null), (vn = !1), e)
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
      return gc && t.locale !== 'ko' ? null : t.data;
    default:
      return null;
  }
}
var om = {
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
function ws(e) {
  var t = e && e.nodeName && e.nodeName.toLowerCase();
  return t === 'input' ? !!om[e.type] : t === 'textarea';
}
function kc(e, t, n, r) {
  (Ju(r),
    (t = zl(t, 'onChange')),
    0 < t.length &&
      ((n = new di('onChange', 'change', null, n, r)), e.push({ event: n, listeners: t })));
}
var dr = null,
  Er = null;
function am(e) {
  Lc(e, 0);
}
function eo(e) {
  var t = xn(e);
  if (Hu(t)) return e;
}
function im(e, t) {
  if (e === 'change') return t;
}
var Sc = !1;
if (ct) {
  var To;
  if (ct) {
    var Oo = 'oninput' in document;
    if (!Oo) {
      var Es = document.createElement('div');
      (Es.setAttribute('oninput', 'return;'), (Oo = typeof Es.oninput == 'function'));
    }
    To = Oo;
  } else To = !1;
  Sc = To && (!document.documentMode || 9 < document.documentMode);
}
function js() {
  dr && (dr.detachEvent('onpropertychange', wc), (Er = dr = null));
}
function wc(e) {
  if (e.propertyName === 'value' && eo(Er)) {
    var t = [];
    (kc(t, Er, e, oi(e)), tc(am, t));
  }
}
function sm(e, t, n) {
  e === 'focusin'
    ? (js(), (dr = t), (Er = n), dr.attachEvent('onpropertychange', wc))
    : e === 'focusout' && js();
}
function um(e) {
  if (e === 'selectionchange' || e === 'keyup' || e === 'keydown') return eo(Er);
}
function cm(e, t) {
  if (e === 'click') return eo(t);
}
function dm(e, t) {
  if (e === 'input' || e === 'change') return eo(t);
}
function fm(e, t) {
  return (e === t && (e !== 0 || 1 / e === 1 / t)) || (e !== e && t !== t);
}
var be = typeof Object.is == 'function' ? Object.is : fm;
function jr(e, t) {
  if (be(e, t)) return !0;
  if (typeof e != 'object' || e === null || typeof t != 'object' || t === null) return !1;
  var n = Object.keys(e),
    r = Object.keys(t);
  if (n.length !== r.length) return !1;
  for (r = 0; r < n.length; r++) {
    var l = n[r];
    if (!Yo.call(t, l) || !be(e[l], t[l])) return !1;
  }
  return !0;
}
function Ns(e) {
  for (; e && e.firstChild;) e = e.firstChild;
  return e;
}
function Cs(e, t) {
  var n = Ns(e);
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
    n = Ns(n);
  }
}
function Ec(e, t) {
  return e && t
    ? e === t
      ? !0
      : e && e.nodeType === 3
        ? !1
        : t && t.nodeType === 3
          ? Ec(e, t.parentNode)
          : 'contains' in e
            ? e.contains(t)
            : e.compareDocumentPosition
              ? !!(e.compareDocumentPosition(t) & 16)
              : !1
    : !1;
}
function jc() {
  for (var e = window, t = _l(); t instanceof e.HTMLIFrameElement;) {
    try {
      var n = typeof t.contentWindow.location.href == 'string';
    } catch {
      n = !1;
    }
    if (n) e = t.contentWindow;
    else break;
    t = _l(e.document);
  }
  return t;
}
function mi(e) {
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
function pm(e) {
  var t = jc(),
    n = e.focusedElem,
    r = e.selectionRange;
  if (t !== n && n && n.ownerDocument && Ec(n.ownerDocument.documentElement, n)) {
    if (r !== null && mi(n)) {
      if (((t = r.start), (e = r.end), e === void 0 && (e = t), 'selectionStart' in n))
        ((n.selectionStart = t), (n.selectionEnd = Math.min(e, n.value.length)));
      else if (
        ((e = ((t = n.ownerDocument || document) && t.defaultView) || window), e.getSelection)
      ) {
        e = e.getSelection();
        var l = n.textContent.length,
          o = Math.min(r.start, l);
        ((r = r.end === void 0 ? o : Math.min(r.end, l)),
          !e.extend && o > r && ((l = r), (r = o), (o = l)),
          (l = Cs(n, o)));
        var a = Cs(n, r);
        l &&
          a &&
          (e.rangeCount !== 1 ||
            e.anchorNode !== l.node ||
            e.anchorOffset !== l.offset ||
            e.focusNode !== a.node ||
            e.focusOffset !== a.offset) &&
          ((t = t.createRange()),
          t.setStart(l.node, l.offset),
          e.removeAllRanges(),
          o > r
            ? (e.addRange(t), e.extend(a.node, a.offset))
            : (t.setEnd(a.node, a.offset), e.addRange(t)));
      }
    }
    for (t = [], e = n; (e = e.parentNode);)
      e.nodeType === 1 && t.push({ element: e, left: e.scrollLeft, top: e.scrollTop });
    for (typeof n.focus == 'function' && n.focus(), n = 0; n < t.length; n++)
      ((e = t[n]), (e.element.scrollLeft = e.left), (e.element.scrollTop = e.top));
  }
}
var mm = ct && 'documentMode' in document && 11 >= document.documentMode,
  gn = null,
  pa = null,
  fr = null,
  ma = !1;
function _s(e, t, n) {
  var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
  ma ||
    gn == null ||
    gn !== _l(r) ||
    ((r = gn),
    'selectionStart' in r && mi(r)
      ? (r = { start: r.selectionStart, end: r.selectionEnd })
      : ((r = ((r.ownerDocument && r.ownerDocument.defaultView) || window).getSelection()),
        (r = {
          anchorNode: r.anchorNode,
          anchorOffset: r.anchorOffset,
          focusNode: r.focusNode,
          focusOffset: r.focusOffset,
        })),
    (fr && jr(fr, r)) ||
      ((fr = r),
      (r = zl(pa, 'onSelect')),
      0 < r.length &&
        ((t = new di('onSelect', 'select', null, t, n)),
        e.push({ event: t, listeners: r }),
        (t.target = gn))));
}
function nl(e, t) {
  var n = {};
  return (
    (n[e.toLowerCase()] = t.toLowerCase()),
    (n['Webkit' + e] = 'webkit' + t),
    (n['Moz' + e] = 'moz' + t),
    n
  );
}
var yn = {
    animationend: nl('Animation', 'AnimationEnd'),
    animationiteration: nl('Animation', 'AnimationIteration'),
    animationstart: nl('Animation', 'AnimationStart'),
    transitionend: nl('Transition', 'TransitionEnd'),
  },
  Lo = {},
  Nc = {};
ct &&
  ((Nc = document.createElement('div').style),
  'AnimationEvent' in window ||
    (delete yn.animationend.animation,
    delete yn.animationiteration.animation,
    delete yn.animationstart.animation),
  'TransitionEvent' in window || delete yn.transitionend.transition);
function to(e) {
  if (Lo[e]) return Lo[e];
  if (!yn[e]) return e;
  var t = yn[e],
    n;
  for (n in t) if (t.hasOwnProperty(n) && n in Nc) return (Lo[e] = t[n]);
  return e;
}
var Cc = to('animationend'),
  _c = to('animationiteration'),
  Pc = to('animationstart'),
  Tc = to('transitionend'),
  Oc = new Map(),
  Ps =
    'abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel'.split(
      ' ',
    );
function $t(e, t) {
  (Oc.set(e, t), on(t, [e]));
}
for (var Ro = 0; Ro < Ps.length; Ro++) {
  var Do = Ps[Ro],
    hm = Do.toLowerCase(),
    vm = Do[0].toUpperCase() + Do.slice(1);
  $t(hm, 'on' + vm);
}
$t(Cc, 'onAnimationEnd');
$t(_c, 'onAnimationIteration');
$t(Pc, 'onAnimationStart');
$t('dblclick', 'onDoubleClick');
$t('focusin', 'onFocus');
$t('focusout', 'onBlur');
$t(Tc, 'onTransitionEnd');
Rn('onMouseEnter', ['mouseout', 'mouseover']);
Rn('onMouseLeave', ['mouseout', 'mouseover']);
Rn('onPointerEnter', ['pointerout', 'pointerover']);
Rn('onPointerLeave', ['pointerout', 'pointerover']);
on('onChange', 'change click focusin focusout input keydown keyup selectionchange'.split(' '));
on(
  'onSelect',
  'focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange'.split(' '),
);
on('onBeforeInput', ['compositionend', 'keypress', 'textInput', 'paste']);
on('onCompositionEnd', 'compositionend focusout keydown keypress keyup mousedown'.split(' '));
on('onCompositionStart', 'compositionstart focusout keydown keypress keyup mousedown'.split(' '));
on('onCompositionUpdate', 'compositionupdate focusout keydown keypress keyup mousedown'.split(' '));
var ir =
    'abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting'.split(
      ' ',
    ),
  gm = new Set('cancel close invalid load scroll toggle'.split(' ').concat(ir));
function Ts(e, t, n) {
  var r = e.type || 'unknown-event';
  ((e.currentTarget = n), hp(r, t, void 0, e), (e.currentTarget = null));
}
function Lc(e, t) {
  t = (t & 4) !== 0;
  for (var n = 0; n < e.length; n++) {
    var r = e[n],
      l = r.event;
    r = r.listeners;
    e: {
      var o = void 0;
      if (t)
        for (var a = r.length - 1; 0 <= a; a--) {
          var i = r[a],
            u = i.instance,
            c = i.currentTarget;
          if (((i = i.listener), u !== o && l.isPropagationStopped())) break e;
          (Ts(l, i, c), (o = u));
        }
      else
        for (a = 0; a < r.length; a++) {
          if (
            ((i = r[a]),
            (u = i.instance),
            (c = i.currentTarget),
            (i = i.listener),
            u !== o && l.isPropagationStopped())
          )
            break e;
          (Ts(l, i, c), (o = u));
        }
    }
  }
  if (Tl) throw ((e = ua), (Tl = !1), (ua = null), e);
}
function V(e, t) {
  var n = t[xa];
  n === void 0 && (n = t[xa] = new Set());
  var r = e + '__bubble';
  n.has(r) || (Rc(t, e, 2, !1), n.add(r));
}
function zo(e, t, n) {
  var r = 0;
  (t && (r |= 4), Rc(n, e, r, t));
}
var rl = '_reactListening' + Math.random().toString(36).slice(2);
function Nr(e) {
  if (!e[rl]) {
    ((e[rl] = !0),
      Au.forEach(function (n) {
        n !== 'selectionchange' && (gm.has(n) || zo(n, !1, e), zo(n, !0, e));
      }));
    var t = e.nodeType === 9 ? e : e.ownerDocument;
    t === null || t[rl] || ((t[rl] = !0), zo('selectionchange', !1, t));
  }
}
function Rc(e, t, n, r) {
  switch (hc(t)) {
    case 1:
      var l = Lp;
      break;
    case 4:
      l = Rp;
      break;
    default:
      l = ui;
  }
  ((n = l.bind(null, t, n, e)),
    (l = void 0),
    !sa || (t !== 'touchstart' && t !== 'touchmove' && t !== 'wheel') || (l = !0),
    r
      ? l !== void 0
        ? e.addEventListener(t, n, { capture: !0, passive: l })
        : e.addEventListener(t, n, !0)
      : l !== void 0
        ? e.addEventListener(t, n, { passive: l })
        : e.addEventListener(t, n, !1));
}
function Io(e, t, n, r, l) {
  var o = r;
  if (!(t & 1) && !(t & 2) && r !== null)
    e: for (;;) {
      if (r === null) return;
      var a = r.tag;
      if (a === 3 || a === 4) {
        var i = r.stateNode.containerInfo;
        if (i === l || (i.nodeType === 8 && i.parentNode === l)) break;
        if (a === 4)
          for (a = r.return; a !== null;) {
            var u = a.tag;
            if (
              (u === 3 || u === 4) &&
              ((u = a.stateNode.containerInfo), u === l || (u.nodeType === 8 && u.parentNode === l))
            )
              return;
            a = a.return;
          }
        for (; i !== null;) {
          if (((a = Kt(i)), a === null)) return;
          if (((u = a.tag), u === 5 || u === 6)) {
            r = o = a;
            continue e;
          }
          i = i.parentNode;
        }
      }
      r = r.return;
    }
  tc(function () {
    var c = o,
      m = oi(n),
      d = [];
    e: {
      var f = Oc.get(e);
      if (f !== void 0) {
        var y = di,
          S = e;
        switch (e) {
          case 'keypress':
            if (yl(n) === 0) break e;
          case 'keydown':
          case 'keyup':
            y = bp;
            break;
          case 'focusin':
            ((S = 'focus'), (y = Po));
            break;
          case 'focusout':
            ((S = 'blur'), (y = Po));
            break;
          case 'beforeblur':
          case 'afterblur':
            y = Po;
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
            y = gs;
            break;
          case 'drag':
          case 'dragend':
          case 'dragenter':
          case 'dragexit':
          case 'dragleave':
          case 'dragover':
          case 'dragstart':
          case 'drop':
            y = Ip;
            break;
          case 'touchcancel':
          case 'touchend':
          case 'touchmove':
          case 'touchstart':
            y = Xp;
            break;
          case Cc:
          case _c:
          case Pc:
            y = $p;
            break;
          case Tc:
            y = Zp;
            break;
          case 'scroll':
            y = Dp;
            break;
          case 'wheel':
            y = em;
            break;
          case 'copy':
          case 'cut':
          case 'paste':
            y = Up;
            break;
          case 'gotpointercapture':
          case 'lostpointercapture':
          case 'pointercancel':
          case 'pointerdown':
          case 'pointermove':
          case 'pointerout':
          case 'pointerover':
          case 'pointerup':
            y = xs;
        }
        var x = (t & 4) !== 0,
          E = !x && e === 'scroll',
          h = x ? (f !== null ? f + 'Capture' : null) : f;
        x = [];
        for (var p = c, v; p !== null;) {
          v = p;
          var k = v.stateNode;
          if (
            (v.tag === 5 &&
              k !== null &&
              ((v = k), h !== null && ((k = xr(p, h)), k != null && x.push(Cr(p, k, v)))),
            E)
          )
            break;
          p = p.return;
        }
        0 < x.length && ((f = new y(f, S, null, n, m)), d.push({ event: f, listeners: x }));
      }
    }
    if (!(t & 7)) {
      e: {
        if (
          ((f = e === 'mouseover' || e === 'pointerover'),
          (y = e === 'mouseout' || e === 'pointerout'),
          f && n !== aa && (S = n.relatedTarget || n.fromElement) && (Kt(S) || S[dt]))
        )
          break e;
        if (
          (y || f) &&
          ((f =
            m.window === m ? m : (f = m.ownerDocument) ? f.defaultView || f.parentWindow : window),
          y
            ? ((S = n.relatedTarget || n.toElement),
              (y = c),
              (S = S ? Kt(S) : null),
              S !== null && ((E = an(S)), S !== E || (S.tag !== 5 && S.tag !== 6)) && (S = null))
            : ((y = null), (S = c)),
          y !== S)
        ) {
          if (
            ((x = gs),
            (k = 'onMouseLeave'),
            (h = 'onMouseEnter'),
            (p = 'mouse'),
            (e === 'pointerout' || e === 'pointerover') &&
              ((x = xs), (k = 'onPointerLeave'), (h = 'onPointerEnter'), (p = 'pointer')),
            (E = y == null ? f : xn(y)),
            (v = S == null ? f : xn(S)),
            (f = new x(k, p + 'leave', y, n, m)),
            (f.target = E),
            (f.relatedTarget = v),
            (k = null),
            Kt(m) === c &&
              ((x = new x(h, p + 'enter', S, n, m)),
              (x.target = v),
              (x.relatedTarget = E),
              (k = x)),
            (E = k),
            y && S)
          )
            t: {
              for (x = y, h = S, p = 0, v = x; v; v = fn(v)) p++;
              for (v = 0, k = h; k; k = fn(k)) v++;
              for (; 0 < p - v;) ((x = fn(x)), p--);
              for (; 0 < v - p;) ((h = fn(h)), v--);
              for (; p--;) {
                if (x === h || (h !== null && x === h.alternate)) break t;
                ((x = fn(x)), (h = fn(h)));
              }
              x = null;
            }
          else x = null;
          (y !== null && Os(d, f, y, x, !1), S !== null && E !== null && Os(d, E, S, x, !0));
        }
      }
      e: {
        if (
          ((f = c ? xn(c) : window),
          (y = f.nodeName && f.nodeName.toLowerCase()),
          y === 'select' || (y === 'input' && f.type === 'file'))
        )
          var j = im;
        else if (ws(f))
          if (Sc) j = dm;
          else {
            j = um;
            var P = sm;
          }
        else
          (y = f.nodeName) &&
            y.toLowerCase() === 'input' &&
            (f.type === 'checkbox' || f.type === 'radio') &&
            (j = cm);
        if (j && (j = j(e, c))) {
          kc(d, j, n, m);
          break e;
        }
        (P && P(e, f, c),
          e === 'focusout' &&
            (P = f._wrapperState) &&
            P.controlled &&
            f.type === 'number' &&
            ta(f, 'number', f.value));
      }
      switch (((P = c ? xn(c) : window), e)) {
        case 'focusin':
          (ws(P) || P.contentEditable === 'true') && ((gn = P), (pa = c), (fr = null));
          break;
        case 'focusout':
          fr = pa = gn = null;
          break;
        case 'mousedown':
          ma = !0;
          break;
        case 'contextmenu':
        case 'mouseup':
        case 'dragend':
          ((ma = !1), _s(d, n, m));
          break;
        case 'selectionchange':
          if (mm) break;
        case 'keydown':
        case 'keyup':
          _s(d, n, m);
      }
      var T;
      if (pi)
        e: {
          switch (e) {
            case 'compositionstart':
              var _ = 'onCompositionStart';
              break e;
            case 'compositionend':
              _ = 'onCompositionEnd';
              break e;
            case 'compositionupdate':
              _ = 'onCompositionUpdate';
              break e;
          }
          _ = void 0;
        }
      else
        vn
          ? yc(e, n) && (_ = 'onCompositionEnd')
          : e === 'keydown' && n.keyCode === 229 && (_ = 'onCompositionStart');
      (_ &&
        (gc &&
          n.locale !== 'ko' &&
          (vn || _ !== 'onCompositionStart'
            ? _ === 'onCompositionEnd' && vn && (T = vc())
            : ((jt = m), (ci = 'value' in jt ? jt.value : jt.textContent), (vn = !0))),
        (P = zl(c, _)),
        0 < P.length &&
          ((_ = new ys(_, e, null, n, m)),
          d.push({ event: _, listeners: P }),
          T ? (_.data = T) : ((T = xc(n)), T !== null && (_.data = T)))),
        (T = nm ? rm(e, n) : lm(e, n)) &&
          ((c = zl(c, 'onBeforeInput')),
          0 < c.length &&
            ((m = new ys('onBeforeInput', 'beforeinput', null, n, m)),
            d.push({ event: m, listeners: c }),
            (m.data = T))));
    }
    Lc(d, t);
  });
}
function Cr(e, t, n) {
  return { instance: e, listener: t, currentTarget: n };
}
function zl(e, t) {
  for (var n = t + 'Capture', r = []; e !== null;) {
    var l = e,
      o = l.stateNode;
    (l.tag === 5 &&
      o !== null &&
      ((l = o),
      (o = xr(e, n)),
      o != null && r.unshift(Cr(e, o, l)),
      (o = xr(e, t)),
      o != null && r.push(Cr(e, o, l))),
      (e = e.return));
  }
  return r;
}
function fn(e) {
  if (e === null) return null;
  do e = e.return;
  while (e && e.tag !== 5);
  return e || null;
}
function Os(e, t, n, r, l) {
  for (var o = t._reactName, a = []; n !== null && n !== r;) {
    var i = n,
      u = i.alternate,
      c = i.stateNode;
    if (u !== null && u === r) break;
    (i.tag === 5 &&
      c !== null &&
      ((i = c),
      l
        ? ((u = xr(n, o)), u != null && a.unshift(Cr(n, u, i)))
        : l || ((u = xr(n, o)), u != null && a.push(Cr(n, u, i)))),
      (n = n.return));
  }
  a.length !== 0 && e.push({ event: t, listeners: a });
}
var ym = /\r\n?/g,
  xm = /\u0000|\uFFFD/g;
function Ls(e) {
  return (typeof e == 'string' ? e : '' + e)
    .replace(
      ym,
      `
`,
    )
    .replace(xm, '');
}
function ll(e, t, n) {
  if (((t = Ls(t)), Ls(e) !== t && n)) throw Error(w(425));
}
function Il() {}
var ha = null,
  va = null;
function ga(e, t) {
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
var ya = typeof setTimeout == 'function' ? setTimeout : void 0,
  km = typeof clearTimeout == 'function' ? clearTimeout : void 0,
  Rs = typeof Promise == 'function' ? Promise : void 0,
  Sm =
    typeof queueMicrotask == 'function'
      ? queueMicrotask
      : typeof Rs < 'u'
        ? function (e) {
            return Rs.resolve(null).then(e).catch(wm);
          }
        : ya;
function wm(e) {
  setTimeout(function () {
    throw e;
  });
}
function Mo(e, t) {
  var n = t,
    r = 0;
  do {
    var l = n.nextSibling;
    if ((e.removeChild(n), l && l.nodeType === 8))
      if (((n = l.data), n === '/$')) {
        if (r === 0) {
          (e.removeChild(l), wr(t));
          return;
        }
        r--;
      } else (n !== '$' && n !== '$?' && n !== '$!') || r++;
    n = l;
  } while (n);
  wr(t);
}
function Ot(e) {
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
function Ds(e) {
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
var Vn = Math.random().toString(36).slice(2),
  Ze = '__reactFiber$' + Vn,
  _r = '__reactProps$' + Vn,
  dt = '__reactContainer$' + Vn,
  xa = '__reactEvents$' + Vn,
  Em = '__reactListeners$' + Vn,
  jm = '__reactHandles$' + Vn;
function Kt(e) {
  var t = e[Ze];
  if (t) return t;
  for (var n = e.parentNode; n;) {
    if ((t = n[dt] || n[Ze])) {
      if (((n = t.alternate), t.child !== null || (n !== null && n.child !== null)))
        for (e = Ds(e); e !== null;) {
          if ((n = e[Ze])) return n;
          e = Ds(e);
        }
      return t;
    }
    ((e = n), (n = e.parentNode));
  }
  return null;
}
function Vr(e) {
  return (
    (e = e[Ze] || e[dt]),
    !e || (e.tag !== 5 && e.tag !== 6 && e.tag !== 13 && e.tag !== 3) ? null : e
  );
}
function xn(e) {
  if (e.tag === 5 || e.tag === 6) return e.stateNode;
  throw Error(w(33));
}
function no(e) {
  return e[_r] || null;
}
var ka = [],
  kn = -1;
function At(e) {
  return { current: e };
}
function W(e) {
  0 > kn || ((e.current = ka[kn]), (ka[kn] = null), kn--);
}
function U(e, t) {
  (kn++, (ka[kn] = e.current), (e.current = t));
}
var Mt = {},
  pe = At(Mt),
  Se = At(!1),
  en = Mt;
function Dn(e, t) {
  var n = e.type.contextTypes;
  if (!n) return Mt;
  var r = e.stateNode;
  if (r && r.__reactInternalMemoizedUnmaskedChildContext === t)
    return r.__reactInternalMemoizedMaskedChildContext;
  var l = {},
    o;
  for (o in n) l[o] = t[o];
  return (
    r &&
      ((e = e.stateNode),
      (e.__reactInternalMemoizedUnmaskedChildContext = t),
      (e.__reactInternalMemoizedMaskedChildContext = l)),
    l
  );
}
function we(e) {
  return ((e = e.childContextTypes), e != null);
}
function Ml() {
  (W(Se), W(pe));
}
function zs(e, t, n) {
  if (pe.current !== Mt) throw Error(w(168));
  (U(pe, t), U(Se, n));
}
function Dc(e, t, n) {
  var r = e.stateNode;
  if (((t = t.childContextTypes), typeof r.getChildContext != 'function')) return n;
  r = r.getChildContext();
  for (var l in r) if (!(l in t)) throw Error(w(108, sp(e) || 'Unknown', l));
  return b({}, n, r);
}
function Fl(e) {
  return (
    (e = ((e = e.stateNode) && e.__reactInternalMemoizedMergedChildContext) || Mt),
    (en = pe.current),
    U(pe, e),
    U(Se, Se.current),
    !0
  );
}
function Is(e, t, n) {
  var r = e.stateNode;
  if (!r) throw Error(w(169));
  (n
    ? ((e = Dc(e, t, en)),
      (r.__reactInternalMemoizedMergedChildContext = e),
      W(Se),
      W(pe),
      U(pe, e))
    : W(Se),
    U(Se, n));
}
var at = null,
  ro = !1,
  Fo = !1;
function zc(e) {
  at === null ? (at = [e]) : at.push(e);
}
function Nm(e) {
  ((ro = !0), zc(e));
}
function Ut() {
  if (!Fo && at !== null) {
    Fo = !0;
    var e = 0,
      t = M;
    try {
      var n = at;
      for (M = 1; e < n.length; e++) {
        var r = n[e];
        do r = r(!0);
        while (r !== null);
      }
      ((at = null), (ro = !1));
    } catch (l) {
      throw (at !== null && (at = at.slice(e + 1)), oc(ai, Ut), l);
    } finally {
      ((M = t), (Fo = !1));
    }
  }
  return null;
}
var Sn = [],
  wn = 0,
  $l = null,
  Al = 0,
  ze = [],
  Ie = 0,
  tn = null,
  it = 1,
  st = '';
function Wt(e, t) {
  ((Sn[wn++] = Al), (Sn[wn++] = $l), ($l = e), (Al = t));
}
function Ic(e, t, n) {
  ((ze[Ie++] = it), (ze[Ie++] = st), (ze[Ie++] = tn), (tn = e));
  var r = it;
  e = st;
  var l = 32 - Qe(r) - 1;
  ((r &= ~(1 << l)), (n += 1));
  var o = 32 - Qe(t) + l;
  if (30 < o) {
    var a = l - (l % 5);
    ((o = (r & ((1 << a) - 1)).toString(32)),
      (r >>= a),
      (l -= a),
      (it = (1 << (32 - Qe(t) + l)) | (n << l) | r),
      (st = o + e));
  } else ((it = (1 << o) | (n << l) | r), (st = e));
}
function hi(e) {
  e.return !== null && (Wt(e, 1), Ic(e, 1, 0));
}
function vi(e) {
  for (; e === $l;) (($l = Sn[--wn]), (Sn[wn] = null), (Al = Sn[--wn]), (Sn[wn] = null));
  for (; e === tn;)
    ((tn = ze[--Ie]),
      (ze[Ie] = null),
      (st = ze[--Ie]),
      (ze[Ie] = null),
      (it = ze[--Ie]),
      (ze[Ie] = null));
}
var Pe = null,
  _e = null,
  H = !1,
  He = null;
function Mc(e, t) {
  var n = Me(5, null, null, 0);
  ((n.elementType = 'DELETED'),
    (n.stateNode = t),
    (n.return = e),
    (t = e.deletions),
    t === null ? ((e.deletions = [n]), (e.flags |= 16)) : t.push(n));
}
function Ms(e, t) {
  switch (e.tag) {
    case 5:
      var n = e.type;
      return (
        (t = t.nodeType !== 1 || n.toLowerCase() !== t.nodeName.toLowerCase() ? null : t),
        t !== null ? ((e.stateNode = t), (Pe = e), (_e = Ot(t.firstChild)), !0) : !1
      );
    case 6:
      return (
        (t = e.pendingProps === '' || t.nodeType !== 3 ? null : t),
        t !== null ? ((e.stateNode = t), (Pe = e), (_e = null), !0) : !1
      );
    case 13:
      return (
        (t = t.nodeType !== 8 ? null : t),
        t !== null
          ? ((n = tn !== null ? { id: it, overflow: st } : null),
            (e.memoizedState = { dehydrated: t, treeContext: n, retryLane: 1073741824 }),
            (n = Me(18, null, null, 0)),
            (n.stateNode = t),
            (n.return = e),
            (e.child = n),
            (Pe = e),
            (_e = null),
            !0)
          : !1
      );
    default:
      return !1;
  }
}
function Sa(e) {
  return (e.mode & 1) !== 0 && (e.flags & 128) === 0;
}
function wa(e) {
  if (H) {
    var t = _e;
    if (t) {
      var n = t;
      if (!Ms(e, t)) {
        if (Sa(e)) throw Error(w(418));
        t = Ot(n.nextSibling);
        var r = Pe;
        t && Ms(e, t) ? Mc(r, n) : ((e.flags = (e.flags & -4097) | 2), (H = !1), (Pe = e));
      }
    } else {
      if (Sa(e)) throw Error(w(418));
      ((e.flags = (e.flags & -4097) | 2), (H = !1), (Pe = e));
    }
  }
}
function Fs(e) {
  for (e = e.return; e !== null && e.tag !== 5 && e.tag !== 3 && e.tag !== 13;) e = e.return;
  Pe = e;
}
function ol(e) {
  if (e !== Pe) return !1;
  if (!H) return (Fs(e), (H = !0), !1);
  var t;
  if (
    ((t = e.tag !== 3) &&
      !(t = e.tag !== 5) &&
      ((t = e.type), (t = t !== 'head' && t !== 'body' && !ga(e.type, e.memoizedProps))),
    t && (t = _e))
  ) {
    if (Sa(e)) throw (Fc(), Error(w(418)));
    for (; t;) (Mc(e, t), (t = Ot(t.nextSibling)));
  }
  if ((Fs(e), e.tag === 13)) {
    if (((e = e.memoizedState), (e = e !== null ? e.dehydrated : null), !e)) throw Error(w(317));
    e: {
      for (e = e.nextSibling, t = 0; e;) {
        if (e.nodeType === 8) {
          var n = e.data;
          if (n === '/$') {
            if (t === 0) {
              _e = Ot(e.nextSibling);
              break e;
            }
            t--;
          } else (n !== '$' && n !== '$!' && n !== '$?') || t++;
        }
        e = e.nextSibling;
      }
      _e = null;
    }
  } else _e = Pe ? Ot(e.stateNode.nextSibling) : null;
  return !0;
}
function Fc() {
  for (var e = _e; e;) e = Ot(e.nextSibling);
}
function zn() {
  ((_e = Pe = null), (H = !1));
}
function gi(e) {
  He === null ? (He = [e]) : He.push(e);
}
var Cm = ht.ReactCurrentBatchConfig;
function er(e, t, n) {
  if (((e = n.ref), e !== null && typeof e != 'function' && typeof e != 'object')) {
    if (n._owner) {
      if (((n = n._owner), n)) {
        if (n.tag !== 1) throw Error(w(309));
        var r = n.stateNode;
      }
      if (!r) throw Error(w(147, e));
      var l = r,
        o = '' + e;
      return t !== null && t.ref !== null && typeof t.ref == 'function' && t.ref._stringRef === o
        ? t.ref
        : ((t = function (a) {
            var i = l.refs;
            a === null ? delete i[o] : (i[o] = a);
          }),
          (t._stringRef = o),
          t);
    }
    if (typeof e != 'string') throw Error(w(284));
    if (!n._owner) throw Error(w(290, e));
  }
  return e;
}
function al(e, t) {
  throw (
    (e = Object.prototype.toString.call(t)),
    Error(
      w(31, e === '[object Object]' ? 'object with keys {' + Object.keys(t).join(', ') + '}' : e),
    )
  );
}
function $s(e) {
  var t = e._init;
  return t(e._payload);
}
function $c(e) {
  function t(h, p) {
    if (e) {
      var v = h.deletions;
      v === null ? ((h.deletions = [p]), (h.flags |= 16)) : v.push(p);
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
    return ((h = zt(h, p)), (h.index = 0), (h.sibling = null), h);
  }
  function o(h, p, v) {
    return (
      (h.index = v),
      e
        ? ((v = h.alternate),
          v !== null ? ((v = v.index), v < p ? ((h.flags |= 2), p) : v) : ((h.flags |= 2), p))
        : ((h.flags |= 1048576), p)
    );
  }
  function a(h) {
    return (e && h.alternate === null && (h.flags |= 2), h);
  }
  function i(h, p, v, k) {
    return p === null || p.tag !== 6
      ? ((p = Ho(v, h.mode, k)), (p.return = h), p)
      : ((p = l(p, v)), (p.return = h), p);
  }
  function u(h, p, v, k) {
    var j = v.type;
    return j === hn
      ? m(h, p, v.props.children, k, v.key)
      : p !== null &&
          (p.elementType === j ||
            (typeof j == 'object' && j !== null && j.$$typeof === kt && $s(j) === p.type))
        ? ((k = l(p, v.props)), (k.ref = er(h, p, v)), (k.return = h), k)
        : ((k = Nl(v.type, v.key, v.props, null, h.mode, k)),
          (k.ref = er(h, p, v)),
          (k.return = h),
          k);
  }
  function c(h, p, v, k) {
    return p === null ||
      p.tag !== 4 ||
      p.stateNode.containerInfo !== v.containerInfo ||
      p.stateNode.implementation !== v.implementation
      ? ((p = Qo(v, h.mode, k)), (p.return = h), p)
      : ((p = l(p, v.children || [])), (p.return = h), p);
  }
  function m(h, p, v, k, j) {
    return p === null || p.tag !== 7
      ? ((p = Jt(v, h.mode, k, j)), (p.return = h), p)
      : ((p = l(p, v)), (p.return = h), p);
  }
  function d(h, p, v) {
    if ((typeof p == 'string' && p !== '') || typeof p == 'number')
      return ((p = Ho('' + p, h.mode, v)), (p.return = h), p);
    if (typeof p == 'object' && p !== null) {
      switch (p.$$typeof) {
        case Gr:
          return (
            (v = Nl(p.type, p.key, p.props, null, h.mode, v)),
            (v.ref = er(h, null, p)),
            (v.return = h),
            v
          );
        case mn:
          return ((p = Qo(p, h.mode, v)), (p.return = h), p);
        case kt:
          var k = p._init;
          return d(h, k(p._payload), v);
      }
      if (or(p) || Gn(p)) return ((p = Jt(p, h.mode, v, null)), (p.return = h), p);
      al(h, p);
    }
    return null;
  }
  function f(h, p, v, k) {
    var j = p !== null ? p.key : null;
    if ((typeof v == 'string' && v !== '') || typeof v == 'number')
      return j !== null ? null : i(h, p, '' + v, k);
    if (typeof v == 'object' && v !== null) {
      switch (v.$$typeof) {
        case Gr:
          return v.key === j ? u(h, p, v, k) : null;
        case mn:
          return v.key === j ? c(h, p, v, k) : null;
        case kt:
          return ((j = v._init), f(h, p, j(v._payload), k));
      }
      if (or(v) || Gn(v)) return j !== null ? null : m(h, p, v, k, null);
      al(h, v);
    }
    return null;
  }
  function y(h, p, v, k, j) {
    if ((typeof k == 'string' && k !== '') || typeof k == 'number')
      return ((h = h.get(v) || null), i(p, h, '' + k, j));
    if (typeof k == 'object' && k !== null) {
      switch (k.$$typeof) {
        case Gr:
          return ((h = h.get(k.key === null ? v : k.key) || null), u(p, h, k, j));
        case mn:
          return ((h = h.get(k.key === null ? v : k.key) || null), c(p, h, k, j));
        case kt:
          var P = k._init;
          return y(h, p, v, P(k._payload), j);
      }
      if (or(k) || Gn(k)) return ((h = h.get(v) || null), m(p, h, k, j, null));
      al(p, k);
    }
    return null;
  }
  function S(h, p, v, k) {
    for (var j = null, P = null, T = p, _ = (p = 0), A = null; T !== null && _ < v.length; _++) {
      T.index > _ ? ((A = T), (T = null)) : (A = T.sibling);
      var R = f(h, T, v[_], k);
      if (R === null) {
        T === null && (T = A);
        break;
      }
      (e && T && R.alternate === null && t(h, T),
        (p = o(R, p, _)),
        P === null ? (j = R) : (P.sibling = R),
        (P = R),
        (T = A));
    }
    if (_ === v.length) return (n(h, T), H && Wt(h, _), j);
    if (T === null) {
      for (; _ < v.length; _++)
        ((T = d(h, v[_], k)),
          T !== null && ((p = o(T, p, _)), P === null ? (j = T) : (P.sibling = T), (P = T)));
      return (H && Wt(h, _), j);
    }
    for (T = r(h, T); _ < v.length; _++)
      ((A = y(T, h, _, v[_], k)),
        A !== null &&
          (e && A.alternate !== null && T.delete(A.key === null ? _ : A.key),
          (p = o(A, p, _)),
          P === null ? (j = A) : (P.sibling = A),
          (P = A)));
    return (
      e &&
        T.forEach(function (I) {
          return t(h, I);
        }),
      H && Wt(h, _),
      j
    );
  }
  function x(h, p, v, k) {
    var j = Gn(v);
    if (typeof j != 'function') throw Error(w(150));
    if (((v = j.call(v)), v == null)) throw Error(w(151));
    for (
      var P = (j = null), T = p, _ = (p = 0), A = null, R = v.next();
      T !== null && !R.done;
      _++, R = v.next()
    ) {
      T.index > _ ? ((A = T), (T = null)) : (A = T.sibling);
      var I = f(h, T, R.value, k);
      if (I === null) {
        T === null && (T = A);
        break;
      }
      (e && T && I.alternate === null && t(h, T),
        (p = o(I, p, _)),
        P === null ? (j = I) : (P.sibling = I),
        (P = I),
        (T = A));
    }
    if (R.done) return (n(h, T), H && Wt(h, _), j);
    if (T === null) {
      for (; !R.done; _++, R = v.next())
        ((R = d(h, R.value, k)),
          R !== null && ((p = o(R, p, _)), P === null ? (j = R) : (P.sibling = R), (P = R)));
      return (H && Wt(h, _), j);
    }
    for (T = r(h, T); !R.done; _++, R = v.next())
      ((R = y(T, h, _, R.value, k)),
        R !== null &&
          (e && R.alternate !== null && T.delete(R.key === null ? _ : R.key),
          (p = o(R, p, _)),
          P === null ? (j = R) : (P.sibling = R),
          (P = R)));
    return (
      e &&
        T.forEach(function (je) {
          return t(h, je);
        }),
      H && Wt(h, _),
      j
    );
  }
  function E(h, p, v, k) {
    if (
      (typeof v == 'object' &&
        v !== null &&
        v.type === hn &&
        v.key === null &&
        (v = v.props.children),
      typeof v == 'object' && v !== null)
    ) {
      switch (v.$$typeof) {
        case Gr:
          e: {
            for (var j = v.key, P = p; P !== null;) {
              if (P.key === j) {
                if (((j = v.type), j === hn)) {
                  if (P.tag === 7) {
                    (n(h, P.sibling), (p = l(P, v.props.children)), (p.return = h), (h = p));
                    break e;
                  }
                } else if (
                  P.elementType === j ||
                  (typeof j == 'object' && j !== null && j.$$typeof === kt && $s(j) === P.type)
                ) {
                  (n(h, P.sibling),
                    (p = l(P, v.props)),
                    (p.ref = er(h, P, v)),
                    (p.return = h),
                    (h = p));
                  break e;
                }
                n(h, P);
                break;
              } else t(h, P);
              P = P.sibling;
            }
            v.type === hn
              ? ((p = Jt(v.props.children, h.mode, k, v.key)), (p.return = h), (h = p))
              : ((k = Nl(v.type, v.key, v.props, null, h.mode, k)),
                (k.ref = er(h, p, v)),
                (k.return = h),
                (h = k));
          }
          return a(h);
        case mn:
          e: {
            for (P = v.key; p !== null;) {
              if (p.key === P)
                if (
                  p.tag === 4 &&
                  p.stateNode.containerInfo === v.containerInfo &&
                  p.stateNode.implementation === v.implementation
                ) {
                  (n(h, p.sibling), (p = l(p, v.children || [])), (p.return = h), (h = p));
                  break e;
                } else {
                  n(h, p);
                  break;
                }
              else t(h, p);
              p = p.sibling;
            }
            ((p = Qo(v, h.mode, k)), (p.return = h), (h = p));
          }
          return a(h);
        case kt:
          return ((P = v._init), E(h, p, P(v._payload), k));
      }
      if (or(v)) return S(h, p, v, k);
      if (Gn(v)) return x(h, p, v, k);
      al(h, v);
    }
    return (typeof v == 'string' && v !== '') || typeof v == 'number'
      ? ((v = '' + v),
        p !== null && p.tag === 6
          ? (n(h, p.sibling), (p = l(p, v)), (p.return = h), (h = p))
          : (n(h, p), (p = Ho(v, h.mode, k)), (p.return = h), (h = p)),
        a(h))
      : n(h, p);
  }
  return E;
}
var In = $c(!0),
  Ac = $c(!1),
  Ul = At(null),
  Bl = null,
  En = null,
  yi = null;
function xi() {
  yi = En = Bl = null;
}
function ki(e) {
  var t = Ul.current;
  (W(Ul), (e._currentValue = t));
}
function Ea(e, t, n) {
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
function On(e, t) {
  ((Bl = e),
    (yi = En = null),
    (e = e.dependencies),
    e !== null && e.firstContext !== null && (e.lanes & t && (ke = !0), (e.firstContext = null)));
}
function $e(e) {
  var t = e._currentValue;
  if (yi !== e)
    if (((e = { context: e, memoizedValue: t, next: null }), En === null)) {
      if (Bl === null) throw Error(w(308));
      ((En = e), (Bl.dependencies = { lanes: 0, firstContext: e }));
    } else En = En.next = e;
  return t;
}
var bt = null;
function Si(e) {
  bt === null ? (bt = [e]) : bt.push(e);
}
function Uc(e, t, n, r) {
  var l = t.interleaved;
  return (
    l === null ? ((n.next = n), Si(t)) : ((n.next = l.next), (l.next = n)),
    (t.interleaved = n),
    ft(e, r)
  );
}
function ft(e, t) {
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
var St = !1;
function wi(e) {
  e.updateQueue = {
    baseState: e.memoizedState,
    firstBaseUpdate: null,
    lastBaseUpdate: null,
    shared: { pending: null, interleaved: null, lanes: 0 },
    effects: null,
  };
}
function Bc(e, t) {
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
function ut(e, t) {
  return { eventTime: e, lane: t, tag: 0, payload: null, callback: null, next: null };
}
function Lt(e, t, n) {
  var r = e.updateQueue;
  if (r === null) return null;
  if (((r = r.shared), z & 2)) {
    var l = r.pending;
    return (
      l === null ? (t.next = t) : ((t.next = l.next), (l.next = t)),
      (r.pending = t),
      ft(e, n)
    );
  }
  return (
    (l = r.interleaved),
    l === null ? ((t.next = t), Si(r)) : ((t.next = l.next), (l.next = t)),
    (r.interleaved = t),
    ft(e, n)
  );
}
function xl(e, t, n) {
  if (((t = t.updateQueue), t !== null && ((t = t.shared), (n & 4194240) !== 0))) {
    var r = t.lanes;
    ((r &= e.pendingLanes), (n |= r), (t.lanes = n), ii(e, n));
  }
}
function As(e, t) {
  var n = e.updateQueue,
    r = e.alternate;
  if (r !== null && ((r = r.updateQueue), n === r)) {
    var l = null,
      o = null;
    if (((n = n.firstBaseUpdate), n !== null)) {
      do {
        var a = {
          eventTime: n.eventTime,
          lane: n.lane,
          tag: n.tag,
          payload: n.payload,
          callback: n.callback,
          next: null,
        };
        (o === null ? (l = o = a) : (o = o.next = a), (n = n.next));
      } while (n !== null);
      o === null ? (l = o = t) : (o = o.next = t);
    } else l = o = t;
    ((n = {
      baseState: r.baseState,
      firstBaseUpdate: l,
      lastBaseUpdate: o,
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
function Vl(e, t, n, r) {
  var l = e.updateQueue;
  St = !1;
  var o = l.firstBaseUpdate,
    a = l.lastBaseUpdate,
    i = l.shared.pending;
  if (i !== null) {
    l.shared.pending = null;
    var u = i,
      c = u.next;
    ((u.next = null), a === null ? (o = c) : (a.next = c), (a = u));
    var m = e.alternate;
    m !== null &&
      ((m = m.updateQueue),
      (i = m.lastBaseUpdate),
      i !== a && (i === null ? (m.firstBaseUpdate = c) : (i.next = c), (m.lastBaseUpdate = u)));
  }
  if (o !== null) {
    var d = l.baseState;
    ((a = 0), (m = c = u = null), (i = o));
    do {
      var f = i.lane,
        y = i.eventTime;
      if ((r & f) === f) {
        m !== null &&
          (m = m.next =
            {
              eventTime: y,
              lane: 0,
              tag: i.tag,
              payload: i.payload,
              callback: i.callback,
              next: null,
            });
        e: {
          var S = e,
            x = i;
          switch (((f = t), (y = n), x.tag)) {
            case 1:
              if (((S = x.payload), typeof S == 'function')) {
                d = S.call(y, d, f);
                break e;
              }
              d = S;
              break e;
            case 3:
              S.flags = (S.flags & -65537) | 128;
            case 0:
              if (((S = x.payload), (f = typeof S == 'function' ? S.call(y, d, f) : S), f == null))
                break e;
              d = b({}, d, f);
              break e;
            case 2:
              St = !0;
          }
        }
        i.callback !== null &&
          i.lane !== 0 &&
          ((e.flags |= 64), (f = l.effects), f === null ? (l.effects = [i]) : f.push(i));
      } else
        ((y = {
          eventTime: y,
          lane: f,
          tag: i.tag,
          payload: i.payload,
          callback: i.callback,
          next: null,
        }),
          m === null ? ((c = m = y), (u = d)) : (m = m.next = y),
          (a |= f));
      if (((i = i.next), i === null)) {
        if (((i = l.shared.pending), i === null)) break;
        ((f = i), (i = f.next), (f.next = null), (l.lastBaseUpdate = f), (l.shared.pending = null));
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
      do ((a |= l.lane), (l = l.next));
      while (l !== t);
    } else o === null && (l.shared.lanes = 0);
    ((rn |= a), (e.lanes = a), (e.memoizedState = d));
  }
}
function Us(e, t, n) {
  if (((e = t.effects), (t.effects = null), e !== null))
    for (t = 0; t < e.length; t++) {
      var r = e[t],
        l = r.callback;
      if (l !== null) {
        if (((r.callback = null), (r = n), typeof l != 'function')) throw Error(w(191, l));
        l.call(r);
      }
    }
}
var Wr = {},
  tt = At(Wr),
  Pr = At(Wr),
  Tr = At(Wr);
function Yt(e) {
  if (e === Wr) throw Error(w(174));
  return e;
}
function Ei(e, t) {
  switch ((U(Tr, t), U(Pr, e), U(tt, Wr), (e = t.nodeType), e)) {
    case 9:
    case 11:
      t = (t = t.documentElement) ? t.namespaceURI : ra(null, '');
      break;
    default:
      ((e = e === 8 ? t.parentNode : t),
        (t = e.namespaceURI || null),
        (e = e.tagName),
        (t = ra(t, e)));
  }
  (W(tt), U(tt, t));
}
function Mn() {
  (W(tt), W(Pr), W(Tr));
}
function Vc(e) {
  Yt(Tr.current);
  var t = Yt(tt.current),
    n = ra(t, e.type);
  t !== n && (U(Pr, e), U(tt, n));
}
function ji(e) {
  Pr.current === e && (W(tt), W(Pr));
}
var Q = At(0);
function Wl(e) {
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
var $o = [];
function Ni() {
  for (var e = 0; e < $o.length; e++) $o[e]._workInProgressVersionPrimary = null;
  $o.length = 0;
}
var kl = ht.ReactCurrentDispatcher,
  Ao = ht.ReactCurrentBatchConfig,
  nn = 0,
  K = null,
  te = null,
  re = null,
  Hl = !1,
  pr = !1,
  Or = 0,
  _m = 0;
function ue() {
  throw Error(w(321));
}
function Ci(e, t) {
  if (t === null) return !1;
  for (var n = 0; n < t.length && n < e.length; n++) if (!be(e[n], t[n])) return !1;
  return !0;
}
function _i(e, t, n, r, l, o) {
  if (
    ((nn = o),
    (K = t),
    (t.memoizedState = null),
    (t.updateQueue = null),
    (t.lanes = 0),
    (kl.current = e === null || e.memoizedState === null ? Lm : Rm),
    (e = n(r, l)),
    pr)
  ) {
    o = 0;
    do {
      if (((pr = !1), (Or = 0), 25 <= o)) throw Error(w(301));
      ((o += 1), (re = te = null), (t.updateQueue = null), (kl.current = Dm), (e = n(r, l)));
    } while (pr);
  }
  if (
    ((kl.current = Ql),
    (t = te !== null && te.next !== null),
    (nn = 0),
    (re = te = K = null),
    (Hl = !1),
    t)
  )
    throw Error(w(300));
  return e;
}
function Pi() {
  var e = Or !== 0;
  return ((Or = 0), e);
}
function Je() {
  var e = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
  return (re === null ? (K.memoizedState = re = e) : (re = re.next = e), re);
}
function Ae() {
  if (te === null) {
    var e = K.alternate;
    e = e !== null ? e.memoizedState : null;
  } else e = te.next;
  var t = re === null ? K.memoizedState : re.next;
  if (t !== null) ((re = t), (te = e));
  else {
    if (e === null) throw Error(w(310));
    ((te = e),
      (e = {
        memoizedState: te.memoizedState,
        baseState: te.baseState,
        baseQueue: te.baseQueue,
        queue: te.queue,
        next: null,
      }),
      re === null ? (K.memoizedState = re = e) : (re = re.next = e));
  }
  return re;
}
function Lr(e, t) {
  return typeof t == 'function' ? t(e) : t;
}
function Uo(e) {
  var t = Ae(),
    n = t.queue;
  if (n === null) throw Error(w(311));
  n.lastRenderedReducer = e;
  var r = te,
    l = r.baseQueue,
    o = n.pending;
  if (o !== null) {
    if (l !== null) {
      var a = l.next;
      ((l.next = o.next), (o.next = a));
    }
    ((r.baseQueue = l = o), (n.pending = null));
  }
  if (l !== null) {
    ((o = l.next), (r = r.baseState));
    var i = (a = null),
      u = null,
      c = o;
    do {
      var m = c.lane;
      if ((nn & m) === m)
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
        (u === null ? ((i = u = d), (a = r)) : (u = u.next = d), (K.lanes |= m), (rn |= m));
      }
      c = c.next;
    } while (c !== null && c !== o);
    (u === null ? (a = r) : (u.next = i),
      be(r, t.memoizedState) || (ke = !0),
      (t.memoizedState = r),
      (t.baseState = a),
      (t.baseQueue = u),
      (n.lastRenderedState = r));
  }
  if (((e = n.interleaved), e !== null)) {
    l = e;
    do ((o = l.lane), (K.lanes |= o), (rn |= o), (l = l.next));
    while (l !== e);
  } else l === null && (n.lanes = 0);
  return [t.memoizedState, n.dispatch];
}
function Bo(e) {
  var t = Ae(),
    n = t.queue;
  if (n === null) throw Error(w(311));
  n.lastRenderedReducer = e;
  var r = n.dispatch,
    l = n.pending,
    o = t.memoizedState;
  if (l !== null) {
    n.pending = null;
    var a = (l = l.next);
    do ((o = e(o, a.action)), (a = a.next));
    while (a !== l);
    (be(o, t.memoizedState) || (ke = !0),
      (t.memoizedState = o),
      t.baseQueue === null && (t.baseState = o),
      (n.lastRenderedState = o));
  }
  return [o, r];
}
function Wc() {}
function Hc(e, t) {
  var n = K,
    r = Ae(),
    l = t(),
    o = !be(r.memoizedState, l);
  if (
    (o && ((r.memoizedState = l), (ke = !0)),
    (r = r.queue),
    Ti(bc.bind(null, n, r, e), [e]),
    r.getSnapshot !== t || o || (re !== null && re.memoizedState.tag & 1))
  ) {
    if (((n.flags |= 2048), Rr(9, Kc.bind(null, n, r, l, t), void 0, null), oe === null))
      throw Error(w(349));
    nn & 30 || Qc(n, t, l);
  }
  return l;
}
function Qc(e, t, n) {
  ((e.flags |= 16384),
    (e = { getSnapshot: t, value: n }),
    (t = K.updateQueue),
    t === null
      ? ((t = { lastEffect: null, stores: null }), (K.updateQueue = t), (t.stores = [e]))
      : ((n = t.stores), n === null ? (t.stores = [e]) : n.push(e)));
}
function Kc(e, t, n, r) {
  ((t.value = n), (t.getSnapshot = r), Yc(t) && Gc(e));
}
function bc(e, t, n) {
  return n(function () {
    Yc(t) && Gc(e);
  });
}
function Yc(e) {
  var t = e.getSnapshot;
  e = e.value;
  try {
    var n = t();
    return !be(e, n);
  } catch {
    return !0;
  }
}
function Gc(e) {
  var t = ft(e, 1);
  t !== null && Ke(t, e, 1, -1);
}
function Bs(e) {
  var t = Je();
  return (
    typeof e == 'function' && (e = e()),
    (t.memoizedState = t.baseState = e),
    (e = {
      pending: null,
      interleaved: null,
      lanes: 0,
      dispatch: null,
      lastRenderedReducer: Lr,
      lastRenderedState: e,
    }),
    (t.queue = e),
    (e = e.dispatch = Om.bind(null, K, e)),
    [t.memoizedState, e]
  );
}
function Rr(e, t, n, r) {
  return (
    (e = { tag: e, create: t, destroy: n, deps: r, next: null }),
    (t = K.updateQueue),
    t === null
      ? ((t = { lastEffect: null, stores: null }), (K.updateQueue = t), (t.lastEffect = e.next = e))
      : ((n = t.lastEffect),
        n === null
          ? (t.lastEffect = e.next = e)
          : ((r = n.next), (n.next = e), (e.next = r), (t.lastEffect = e))),
    e
  );
}
function Xc() {
  return Ae().memoizedState;
}
function Sl(e, t, n, r) {
  var l = Je();
  ((K.flags |= e), (l.memoizedState = Rr(1 | t, n, void 0, r === void 0 ? null : r)));
}
function lo(e, t, n, r) {
  var l = Ae();
  r = r === void 0 ? null : r;
  var o = void 0;
  if (te !== null) {
    var a = te.memoizedState;
    if (((o = a.destroy), r !== null && Ci(r, a.deps))) {
      l.memoizedState = Rr(t, n, o, r);
      return;
    }
  }
  ((K.flags |= e), (l.memoizedState = Rr(1 | t, n, o, r)));
}
function Vs(e, t) {
  return Sl(8390656, 8, e, t);
}
function Ti(e, t) {
  return lo(2048, 8, e, t);
}
function Jc(e, t) {
  return lo(4, 2, e, t);
}
function Zc(e, t) {
  return lo(4, 4, e, t);
}
function qc(e, t) {
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
function ed(e, t, n) {
  return ((n = n != null ? n.concat([e]) : null), lo(4, 4, qc.bind(null, t, e), n));
}
function Oi() {}
function td(e, t) {
  var n = Ae();
  t = t === void 0 ? null : t;
  var r = n.memoizedState;
  return r !== null && t !== null && Ci(t, r[1]) ? r[0] : ((n.memoizedState = [e, t]), e);
}
function nd(e, t) {
  var n = Ae();
  t = t === void 0 ? null : t;
  var r = n.memoizedState;
  return r !== null && t !== null && Ci(t, r[1])
    ? r[0]
    : ((e = e()), (n.memoizedState = [e, t]), e);
}
function rd(e, t, n) {
  return nn & 21
    ? (be(n, t) || ((n = sc()), (K.lanes |= n), (rn |= n), (e.baseState = !0)), t)
    : (e.baseState && ((e.baseState = !1), (ke = !0)), (e.memoizedState = n));
}
function Pm(e, t) {
  var n = M;
  ((M = n !== 0 && 4 > n ? n : 4), e(!0));
  var r = Ao.transition;
  Ao.transition = {};
  try {
    (e(!1), t());
  } finally {
    ((M = n), (Ao.transition = r));
  }
}
function ld() {
  return Ae().memoizedState;
}
function Tm(e, t, n) {
  var r = Dt(e);
  if (((n = { lane: r, action: n, hasEagerState: !1, eagerState: null, next: null }), od(e)))
    ad(t, n);
  else if (((n = Uc(e, t, n, r)), n !== null)) {
    var l = he();
    (Ke(n, e, r, l), id(n, t, r));
  }
}
function Om(e, t, n) {
  var r = Dt(e),
    l = { lane: r, action: n, hasEagerState: !1, eagerState: null, next: null };
  if (od(e)) ad(t, l);
  else {
    var o = e.alternate;
    if (e.lanes === 0 && (o === null || o.lanes === 0) && ((o = t.lastRenderedReducer), o !== null))
      try {
        var a = t.lastRenderedState,
          i = o(a, n);
        if (((l.hasEagerState = !0), (l.eagerState = i), be(i, a))) {
          var u = t.interleaved;
          (u === null ? ((l.next = l), Si(t)) : ((l.next = u.next), (u.next = l)),
            (t.interleaved = l));
          return;
        }
      } catch {
      } finally {
      }
    ((n = Uc(e, t, l, r)), n !== null && ((l = he()), Ke(n, e, r, l), id(n, t, r)));
  }
}
function od(e) {
  var t = e.alternate;
  return e === K || (t !== null && t === K);
}
function ad(e, t) {
  pr = Hl = !0;
  var n = e.pending;
  (n === null ? (t.next = t) : ((t.next = n.next), (n.next = t)), (e.pending = t));
}
function id(e, t, n) {
  if (n & 4194240) {
    var r = t.lanes;
    ((r &= e.pendingLanes), (n |= r), (t.lanes = n), ii(e, n));
  }
}
var Ql = {
    readContext: $e,
    useCallback: ue,
    useContext: ue,
    useEffect: ue,
    useImperativeHandle: ue,
    useInsertionEffect: ue,
    useLayoutEffect: ue,
    useMemo: ue,
    useReducer: ue,
    useRef: ue,
    useState: ue,
    useDebugValue: ue,
    useDeferredValue: ue,
    useTransition: ue,
    useMutableSource: ue,
    useSyncExternalStore: ue,
    useId: ue,
    unstable_isNewReconciler: !1,
  },
  Lm = {
    readContext: $e,
    useCallback: function (e, t) {
      return ((Je().memoizedState = [e, t === void 0 ? null : t]), e);
    },
    useContext: $e,
    useEffect: Vs,
    useImperativeHandle: function (e, t, n) {
      return ((n = n != null ? n.concat([e]) : null), Sl(4194308, 4, qc.bind(null, t, e), n));
    },
    useLayoutEffect: function (e, t) {
      return Sl(4194308, 4, e, t);
    },
    useInsertionEffect: function (e, t) {
      return Sl(4, 2, e, t);
    },
    useMemo: function (e, t) {
      var n = Je();
      return ((t = t === void 0 ? null : t), (e = e()), (n.memoizedState = [e, t]), e);
    },
    useReducer: function (e, t, n) {
      var r = Je();
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
        (e = e.dispatch = Tm.bind(null, K, e)),
        [r.memoizedState, e]
      );
    },
    useRef: function (e) {
      var t = Je();
      return ((e = { current: e }), (t.memoizedState = e));
    },
    useState: Bs,
    useDebugValue: Oi,
    useDeferredValue: function (e) {
      return (Je().memoizedState = e);
    },
    useTransition: function () {
      var e = Bs(!1),
        t = e[0];
      return ((e = Pm.bind(null, e[1])), (Je().memoizedState = e), [t, e]);
    },
    useMutableSource: function () {},
    useSyncExternalStore: function (e, t, n) {
      var r = K,
        l = Je();
      if (H) {
        if (n === void 0) throw Error(w(407));
        n = n();
      } else {
        if (((n = t()), oe === null)) throw Error(w(349));
        nn & 30 || Qc(r, t, n);
      }
      l.memoizedState = n;
      var o = { value: n, getSnapshot: t };
      return (
        (l.queue = o),
        Vs(bc.bind(null, r, o, e), [e]),
        (r.flags |= 2048),
        Rr(9, Kc.bind(null, r, o, n, t), void 0, null),
        n
      );
    },
    useId: function () {
      var e = Je(),
        t = oe.identifierPrefix;
      if (H) {
        var n = st,
          r = it;
        ((n = (r & ~(1 << (32 - Qe(r) - 1))).toString(32) + n),
          (t = ':' + t + 'R' + n),
          (n = Or++),
          0 < n && (t += 'H' + n.toString(32)),
          (t += ':'));
      } else ((n = _m++), (t = ':' + t + 'r' + n.toString(32) + ':'));
      return (e.memoizedState = t);
    },
    unstable_isNewReconciler: !1,
  },
  Rm = {
    readContext: $e,
    useCallback: td,
    useContext: $e,
    useEffect: Ti,
    useImperativeHandle: ed,
    useInsertionEffect: Jc,
    useLayoutEffect: Zc,
    useMemo: nd,
    useReducer: Uo,
    useRef: Xc,
    useState: function () {
      return Uo(Lr);
    },
    useDebugValue: Oi,
    useDeferredValue: function (e) {
      var t = Ae();
      return rd(t, te.memoizedState, e);
    },
    useTransition: function () {
      var e = Uo(Lr)[0],
        t = Ae().memoizedState;
      return [e, t];
    },
    useMutableSource: Wc,
    useSyncExternalStore: Hc,
    useId: ld,
    unstable_isNewReconciler: !1,
  },
  Dm = {
    readContext: $e,
    useCallback: td,
    useContext: $e,
    useEffect: Ti,
    useImperativeHandle: ed,
    useInsertionEffect: Jc,
    useLayoutEffect: Zc,
    useMemo: nd,
    useReducer: Bo,
    useRef: Xc,
    useState: function () {
      return Bo(Lr);
    },
    useDebugValue: Oi,
    useDeferredValue: function (e) {
      var t = Ae();
      return te === null ? (t.memoizedState = e) : rd(t, te.memoizedState, e);
    },
    useTransition: function () {
      var e = Bo(Lr)[0],
        t = Ae().memoizedState;
      return [e, t];
    },
    useMutableSource: Wc,
    useSyncExternalStore: Hc,
    useId: ld,
    unstable_isNewReconciler: !1,
  };
function Ve(e, t) {
  if (e && e.defaultProps) {
    ((t = b({}, t)), (e = e.defaultProps));
    for (var n in e) t[n] === void 0 && (t[n] = e[n]);
    return t;
  }
  return t;
}
function ja(e, t, n, r) {
  ((t = e.memoizedState),
    (n = n(r, t)),
    (n = n == null ? t : b({}, t, n)),
    (e.memoizedState = n),
    e.lanes === 0 && (e.updateQueue.baseState = n));
}
var oo = {
  isMounted: function (e) {
    return (e = e._reactInternals) ? an(e) === e : !1;
  },
  enqueueSetState: function (e, t, n) {
    e = e._reactInternals;
    var r = he(),
      l = Dt(e),
      o = ut(r, l);
    ((o.payload = t),
      n != null && (o.callback = n),
      (t = Lt(e, o, l)),
      t !== null && (Ke(t, e, l, r), xl(t, e, l)));
  },
  enqueueReplaceState: function (e, t, n) {
    e = e._reactInternals;
    var r = he(),
      l = Dt(e),
      o = ut(r, l);
    ((o.tag = 1),
      (o.payload = t),
      n != null && (o.callback = n),
      (t = Lt(e, o, l)),
      t !== null && (Ke(t, e, l, r), xl(t, e, l)));
  },
  enqueueForceUpdate: function (e, t) {
    e = e._reactInternals;
    var n = he(),
      r = Dt(e),
      l = ut(n, r);
    ((l.tag = 2),
      t != null && (l.callback = t),
      (t = Lt(e, l, r)),
      t !== null && (Ke(t, e, r, n), xl(t, e, r)));
  },
};
function Ws(e, t, n, r, l, o, a) {
  return (
    (e = e.stateNode),
    typeof e.shouldComponentUpdate == 'function'
      ? e.shouldComponentUpdate(r, o, a)
      : t.prototype && t.prototype.isPureReactComponent
        ? !jr(n, r) || !jr(l, o)
        : !0
  );
}
function sd(e, t, n) {
  var r = !1,
    l = Mt,
    o = t.contextType;
  return (
    typeof o == 'object' && o !== null
      ? (o = $e(o))
      : ((l = we(t) ? en : pe.current),
        (r = t.contextTypes),
        (o = (r = r != null) ? Dn(e, l) : Mt)),
    (t = new t(n, o)),
    (e.memoizedState = t.state !== null && t.state !== void 0 ? t.state : null),
    (t.updater = oo),
    (e.stateNode = t),
    (t._reactInternals = e),
    r &&
      ((e = e.stateNode),
      (e.__reactInternalMemoizedUnmaskedChildContext = l),
      (e.__reactInternalMemoizedMaskedChildContext = o)),
    t
  );
}
function Hs(e, t, n, r) {
  ((e = t.state),
    typeof t.componentWillReceiveProps == 'function' && t.componentWillReceiveProps(n, r),
    typeof t.UNSAFE_componentWillReceiveProps == 'function' &&
      t.UNSAFE_componentWillReceiveProps(n, r),
    t.state !== e && oo.enqueueReplaceState(t, t.state, null));
}
function Na(e, t, n, r) {
  var l = e.stateNode;
  ((l.props = n), (l.state = e.memoizedState), (l.refs = {}), wi(e));
  var o = t.contextType;
  (typeof o == 'object' && o !== null
    ? (l.context = $e(o))
    : ((o = we(t) ? en : pe.current), (l.context = Dn(e, o))),
    (l.state = e.memoizedState),
    (o = t.getDerivedStateFromProps),
    typeof o == 'function' && (ja(e, t, o, n), (l.state = e.memoizedState)),
    typeof t.getDerivedStateFromProps == 'function' ||
      typeof l.getSnapshotBeforeUpdate == 'function' ||
      (typeof l.UNSAFE_componentWillMount != 'function' &&
        typeof l.componentWillMount != 'function') ||
      ((t = l.state),
      typeof l.componentWillMount == 'function' && l.componentWillMount(),
      typeof l.UNSAFE_componentWillMount == 'function' && l.UNSAFE_componentWillMount(),
      t !== l.state && oo.enqueueReplaceState(l, l.state, null),
      Vl(e, n, l, r),
      (l.state = e.memoizedState)),
    typeof l.componentDidMount == 'function' && (e.flags |= 4194308));
}
function Fn(e, t) {
  try {
    var n = '',
      r = t;
    do ((n += ip(r)), (r = r.return));
    while (r);
    var l = n;
  } catch (o) {
    l =
      `
Error generating stack: ` +
      o.message +
      `
` +
      o.stack;
  }
  return { value: e, source: t, stack: l, digest: null };
}
function Vo(e, t, n) {
  return { value: e, source: null, stack: n ?? null, digest: t ?? null };
}
function Ca(e, t) {
  try {
    console.error(t.value);
  } catch (n) {
    setTimeout(function () {
      throw n;
    });
  }
}
var zm = typeof WeakMap == 'function' ? WeakMap : Map;
function ud(e, t, n) {
  ((n = ut(-1, n)), (n.tag = 3), (n.payload = { element: null }));
  var r = t.value;
  return (
    (n.callback = function () {
      (bl || ((bl = !0), (Ma = r)), Ca(e, t));
    }),
    n
  );
}
function cd(e, t, n) {
  ((n = ut(-1, n)), (n.tag = 3));
  var r = e.type.getDerivedStateFromError;
  if (typeof r == 'function') {
    var l = t.value;
    ((n.payload = function () {
      return r(l);
    }),
      (n.callback = function () {
        Ca(e, t);
      }));
  }
  var o = e.stateNode;
  return (
    o !== null &&
      typeof o.componentDidCatch == 'function' &&
      (n.callback = function () {
        (Ca(e, t), typeof r != 'function' && (Rt === null ? (Rt = new Set([this])) : Rt.add(this)));
        var a = t.stack;
        this.componentDidCatch(t.value, { componentStack: a !== null ? a : '' });
      }),
    n
  );
}
function Qs(e, t, n) {
  var r = e.pingCache;
  if (r === null) {
    r = e.pingCache = new zm();
    var l = new Set();
    r.set(t, l);
  } else ((l = r.get(t)), l === void 0 && ((l = new Set()), r.set(t, l)));
  l.has(n) || (l.add(n), (e = Ym.bind(null, e, t, n)), t.then(e, e));
}
function Ks(e) {
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
function bs(e, t, n, r, l) {
  return e.mode & 1
    ? ((e.flags |= 65536), (e.lanes = l), e)
    : (e === t
        ? (e.flags |= 65536)
        : ((e.flags |= 128),
          (n.flags |= 131072),
          (n.flags &= -52805),
          n.tag === 1 &&
            (n.alternate === null ? (n.tag = 17) : ((t = ut(-1, 1)), (t.tag = 2), Lt(n, t, 1))),
          (n.lanes |= 1)),
      e);
}
var Im = ht.ReactCurrentOwner,
  ke = !1;
function me(e, t, n, r) {
  t.child = e === null ? Ac(t, null, n, r) : In(t, e.child, n, r);
}
function Ys(e, t, n, r, l) {
  n = n.render;
  var o = t.ref;
  return (
    On(t, l),
    (r = _i(e, t, n, r, o, l)),
    (n = Pi()),
    e !== null && !ke
      ? ((t.updateQueue = e.updateQueue), (t.flags &= -2053), (e.lanes &= ~l), pt(e, t, l))
      : (H && n && hi(t), (t.flags |= 1), me(e, t, r, l), t.child)
  );
}
function Gs(e, t, n, r, l) {
  if (e === null) {
    var o = n.type;
    return typeof o == 'function' &&
      !$i(o) &&
      o.defaultProps === void 0 &&
      n.compare === null &&
      n.defaultProps === void 0
      ? ((t.tag = 15), (t.type = o), dd(e, t, o, r, l))
      : ((e = Nl(n.type, null, r, t, t.mode, l)), (e.ref = t.ref), (e.return = t), (t.child = e));
  }
  if (((o = e.child), !(e.lanes & l))) {
    var a = o.memoizedProps;
    if (((n = n.compare), (n = n !== null ? n : jr), n(a, r) && e.ref === t.ref))
      return pt(e, t, l);
  }
  return ((t.flags |= 1), (e = zt(o, r)), (e.ref = t.ref), (e.return = t), (t.child = e));
}
function dd(e, t, n, r, l) {
  if (e !== null) {
    var o = e.memoizedProps;
    if (jr(o, r) && e.ref === t.ref)
      if (((ke = !1), (t.pendingProps = r = o), (e.lanes & l) !== 0)) e.flags & 131072 && (ke = !0);
      else return ((t.lanes = e.lanes), pt(e, t, l));
  }
  return _a(e, t, n, r, l);
}
function fd(e, t, n) {
  var r = t.pendingProps,
    l = r.children,
    o = e !== null ? e.memoizedState : null;
  if (r.mode === 'hidden')
    if (!(t.mode & 1))
      ((t.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }),
        U(Nn, Ce),
        (Ce |= n));
    else {
      if (!(n & 1073741824))
        return (
          (e = o !== null ? o.baseLanes | n : n),
          (t.lanes = t.childLanes = 1073741824),
          (t.memoizedState = { baseLanes: e, cachePool: null, transitions: null }),
          (t.updateQueue = null),
          U(Nn, Ce),
          (Ce |= e),
          null
        );
      ((t.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }),
        (r = o !== null ? o.baseLanes : n),
        U(Nn, Ce),
        (Ce |= r));
    }
  else
    (o !== null ? ((r = o.baseLanes | n), (t.memoizedState = null)) : (r = n),
      U(Nn, Ce),
      (Ce |= r));
  return (me(e, t, l, n), t.child);
}
function pd(e, t) {
  var n = t.ref;
  ((e === null && n !== null) || (e !== null && e.ref !== n)) &&
    ((t.flags |= 512), (t.flags |= 2097152));
}
function _a(e, t, n, r, l) {
  var o = we(n) ? en : pe.current;
  return (
    (o = Dn(t, o)),
    On(t, l),
    (n = _i(e, t, n, r, o, l)),
    (r = Pi()),
    e !== null && !ke
      ? ((t.updateQueue = e.updateQueue), (t.flags &= -2053), (e.lanes &= ~l), pt(e, t, l))
      : (H && r && hi(t), (t.flags |= 1), me(e, t, n, l), t.child)
  );
}
function Xs(e, t, n, r, l) {
  if (we(n)) {
    var o = !0;
    Fl(t);
  } else o = !1;
  if ((On(t, l), t.stateNode === null)) (wl(e, t), sd(t, n, r), Na(t, n, r, l), (r = !0));
  else if (e === null) {
    var a = t.stateNode,
      i = t.memoizedProps;
    a.props = i;
    var u = a.context,
      c = n.contextType;
    typeof c == 'object' && c !== null
      ? (c = $e(c))
      : ((c = we(n) ? en : pe.current), (c = Dn(t, c)));
    var m = n.getDerivedStateFromProps,
      d = typeof m == 'function' || typeof a.getSnapshotBeforeUpdate == 'function';
    (d ||
      (typeof a.UNSAFE_componentWillReceiveProps != 'function' &&
        typeof a.componentWillReceiveProps != 'function') ||
      ((i !== r || u !== c) && Hs(t, a, r, c)),
      (St = !1));
    var f = t.memoizedState;
    ((a.state = f),
      Vl(t, r, a, l),
      (u = t.memoizedState),
      i !== r || f !== u || Se.current || St
        ? (typeof m == 'function' && (ja(t, n, m, r), (u = t.memoizedState)),
          (i = St || Ws(t, n, i, r, f, u, c))
            ? (d ||
                (typeof a.UNSAFE_componentWillMount != 'function' &&
                  typeof a.componentWillMount != 'function') ||
                (typeof a.componentWillMount == 'function' && a.componentWillMount(),
                typeof a.UNSAFE_componentWillMount == 'function' && a.UNSAFE_componentWillMount()),
              typeof a.componentDidMount == 'function' && (t.flags |= 4194308))
            : (typeof a.componentDidMount == 'function' && (t.flags |= 4194308),
              (t.memoizedProps = r),
              (t.memoizedState = u)),
          (a.props = r),
          (a.state = u),
          (a.context = c),
          (r = i))
        : (typeof a.componentDidMount == 'function' && (t.flags |= 4194308), (r = !1)));
  } else {
    ((a = t.stateNode),
      Bc(e, t),
      (i = t.memoizedProps),
      (c = t.type === t.elementType ? i : Ve(t.type, i)),
      (a.props = c),
      (d = t.pendingProps),
      (f = a.context),
      (u = n.contextType),
      typeof u == 'object' && u !== null
        ? (u = $e(u))
        : ((u = we(n) ? en : pe.current), (u = Dn(t, u))));
    var y = n.getDerivedStateFromProps;
    ((m = typeof y == 'function' || typeof a.getSnapshotBeforeUpdate == 'function') ||
      (typeof a.UNSAFE_componentWillReceiveProps != 'function' &&
        typeof a.componentWillReceiveProps != 'function') ||
      ((i !== d || f !== u) && Hs(t, a, r, u)),
      (St = !1),
      (f = t.memoizedState),
      (a.state = f),
      Vl(t, r, a, l));
    var S = t.memoizedState;
    i !== d || f !== S || Se.current || St
      ? (typeof y == 'function' && (ja(t, n, y, r), (S = t.memoizedState)),
        (c = St || Ws(t, n, c, r, f, S, u) || !1)
          ? (m ||
              (typeof a.UNSAFE_componentWillUpdate != 'function' &&
                typeof a.componentWillUpdate != 'function') ||
              (typeof a.componentWillUpdate == 'function' && a.componentWillUpdate(r, S, u),
              typeof a.UNSAFE_componentWillUpdate == 'function' &&
                a.UNSAFE_componentWillUpdate(r, S, u)),
            typeof a.componentDidUpdate == 'function' && (t.flags |= 4),
            typeof a.getSnapshotBeforeUpdate == 'function' && (t.flags |= 1024))
          : (typeof a.componentDidUpdate != 'function' ||
              (i === e.memoizedProps && f === e.memoizedState) ||
              (t.flags |= 4),
            typeof a.getSnapshotBeforeUpdate != 'function' ||
              (i === e.memoizedProps && f === e.memoizedState) ||
              (t.flags |= 1024),
            (t.memoizedProps = r),
            (t.memoizedState = S)),
        (a.props = r),
        (a.state = S),
        (a.context = u),
        (r = c))
      : (typeof a.componentDidUpdate != 'function' ||
          (i === e.memoizedProps && f === e.memoizedState) ||
          (t.flags |= 4),
        typeof a.getSnapshotBeforeUpdate != 'function' ||
          (i === e.memoizedProps && f === e.memoizedState) ||
          (t.flags |= 1024),
        (r = !1));
  }
  return Pa(e, t, n, r, o, l);
}
function Pa(e, t, n, r, l, o) {
  pd(e, t);
  var a = (t.flags & 128) !== 0;
  if (!r && !a) return (l && Is(t, n, !1), pt(e, t, o));
  ((r = t.stateNode), (Im.current = t));
  var i = a && typeof n.getDerivedStateFromError != 'function' ? null : r.render();
  return (
    (t.flags |= 1),
    e !== null && a
      ? ((t.child = In(t, e.child, null, o)), (t.child = In(t, null, i, o)))
      : me(e, t, i, o),
    (t.memoizedState = r.state),
    l && Is(t, n, !0),
    t.child
  );
}
function md(e) {
  var t = e.stateNode;
  (t.pendingContext
    ? zs(e, t.pendingContext, t.pendingContext !== t.context)
    : t.context && zs(e, t.context, !1),
    Ei(e, t.containerInfo));
}
function Js(e, t, n, r, l) {
  return (zn(), gi(l), (t.flags |= 256), me(e, t, n, r), t.child);
}
var Ta = { dehydrated: null, treeContext: null, retryLane: 0 };
function Oa(e) {
  return { baseLanes: e, cachePool: null, transitions: null };
}
function hd(e, t, n) {
  var r = t.pendingProps,
    l = Q.current,
    o = !1,
    a = (t.flags & 128) !== 0,
    i;
  if (
    ((i = a) || (i = e !== null && e.memoizedState === null ? !1 : (l & 2) !== 0),
    i ? ((o = !0), (t.flags &= -129)) : (e === null || e.memoizedState !== null) && (l |= 1),
    U(Q, l & 1),
    e === null)
  )
    return (
      wa(t),
      (e = t.memoizedState),
      e !== null && ((e = e.dehydrated), e !== null)
        ? (t.mode & 1 ? (e.data === '$!' ? (t.lanes = 8) : (t.lanes = 1073741824)) : (t.lanes = 1),
          null)
        : ((a = r.children),
          (e = r.fallback),
          o
            ? ((r = t.mode),
              (o = t.child),
              (a = { mode: 'hidden', children: a }),
              !(r & 1) && o !== null
                ? ((o.childLanes = 0), (o.pendingProps = a))
                : (o = so(a, r, 0, null)),
              (e = Jt(e, r, n, null)),
              (o.return = t),
              (e.return = t),
              (o.sibling = e),
              (t.child = o),
              (t.child.memoizedState = Oa(n)),
              (t.memoizedState = Ta),
              e)
            : Li(t, a))
    );
  if (((l = e.memoizedState), l !== null && ((i = l.dehydrated), i !== null)))
    return Mm(e, t, a, r, i, l, n);
  if (o) {
    ((o = r.fallback), (a = t.mode), (l = e.child), (i = l.sibling));
    var u = { mode: 'hidden', children: r.children };
    return (
      !(a & 1) && t.child !== l
        ? ((r = t.child), (r.childLanes = 0), (r.pendingProps = u), (t.deletions = null))
        : ((r = zt(l, u)), (r.subtreeFlags = l.subtreeFlags & 14680064)),
      i !== null ? (o = zt(i, o)) : ((o = Jt(o, a, n, null)), (o.flags |= 2)),
      (o.return = t),
      (r.return = t),
      (r.sibling = o),
      (t.child = r),
      (r = o),
      (o = t.child),
      (a = e.child.memoizedState),
      (a =
        a === null
          ? Oa(n)
          : { baseLanes: a.baseLanes | n, cachePool: null, transitions: a.transitions }),
      (o.memoizedState = a),
      (o.childLanes = e.childLanes & ~n),
      (t.memoizedState = Ta),
      r
    );
  }
  return (
    (o = e.child),
    (e = o.sibling),
    (r = zt(o, { mode: 'visible', children: r.children })),
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
function Li(e, t) {
  return (
    (t = so({ mode: 'visible', children: t }, e.mode, 0, null)),
    (t.return = e),
    (e.child = t)
  );
}
function il(e, t, n, r) {
  return (
    r !== null && gi(r),
    In(t, e.child, null, n),
    (e = Li(t, t.pendingProps.children)),
    (e.flags |= 2),
    (t.memoizedState = null),
    e
  );
}
function Mm(e, t, n, r, l, o, a) {
  if (n)
    return t.flags & 256
      ? ((t.flags &= -257), (r = Vo(Error(w(422)))), il(e, t, a, r))
      : t.memoizedState !== null
        ? ((t.child = e.child), (t.flags |= 128), null)
        : ((o = r.fallback),
          (l = t.mode),
          (r = so({ mode: 'visible', children: r.children }, l, 0, null)),
          (o = Jt(o, l, a, null)),
          (o.flags |= 2),
          (r.return = t),
          (o.return = t),
          (r.sibling = o),
          (t.child = r),
          t.mode & 1 && In(t, e.child, null, a),
          (t.child.memoizedState = Oa(a)),
          (t.memoizedState = Ta),
          o);
  if (!(t.mode & 1)) return il(e, t, a, null);
  if (l.data === '$!') {
    if (((r = l.nextSibling && l.nextSibling.dataset), r)) var i = r.dgst;
    return ((r = i), (o = Error(w(419))), (r = Vo(o, r, void 0)), il(e, t, a, r));
  }
  if (((i = (a & e.childLanes) !== 0), ke || i)) {
    if (((r = oe), r !== null)) {
      switch (a & -a) {
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
      ((l = l & (r.suspendedLanes | a) ? 0 : l),
        l !== 0 && l !== o.retryLane && ((o.retryLane = l), ft(e, l), Ke(r, e, l, -1)));
    }
    return (Fi(), (r = Vo(Error(w(421)))), il(e, t, a, r));
  }
  return l.data === '$?'
    ? ((t.flags |= 128), (t.child = e.child), (t = Gm.bind(null, e)), (l._reactRetry = t), null)
    : ((e = o.treeContext),
      (_e = Ot(l.nextSibling)),
      (Pe = t),
      (H = !0),
      (He = null),
      e !== null &&
        ((ze[Ie++] = it),
        (ze[Ie++] = st),
        (ze[Ie++] = tn),
        (it = e.id),
        (st = e.overflow),
        (tn = t)),
      (t = Li(t, r.children)),
      (t.flags |= 4096),
      t);
}
function Zs(e, t, n) {
  e.lanes |= t;
  var r = e.alternate;
  (r !== null && (r.lanes |= t), Ea(e.return, t, n));
}
function Wo(e, t, n, r, l) {
  var o = e.memoizedState;
  o === null
    ? (e.memoizedState = {
        isBackwards: t,
        rendering: null,
        renderingStartTime: 0,
        last: r,
        tail: n,
        tailMode: l,
      })
    : ((o.isBackwards = t),
      (o.rendering = null),
      (o.renderingStartTime = 0),
      (o.last = r),
      (o.tail = n),
      (o.tailMode = l));
}
function vd(e, t, n) {
  var r = t.pendingProps,
    l = r.revealOrder,
    o = r.tail;
  if ((me(e, t, r.children, n), (r = Q.current), r & 2)) ((r = (r & 1) | 2), (t.flags |= 128));
  else {
    if (e !== null && e.flags & 128)
      e: for (e = t.child; e !== null;) {
        if (e.tag === 13) e.memoizedState !== null && Zs(e, n, t);
        else if (e.tag === 19) Zs(e, n, t);
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
  if ((U(Q, r), !(t.mode & 1))) t.memoizedState = null;
  else
    switch (l) {
      case 'forwards':
        for (n = t.child, l = null; n !== null;)
          ((e = n.alternate), e !== null && Wl(e) === null && (l = n), (n = n.sibling));
        ((n = l),
          n === null ? ((l = t.child), (t.child = null)) : ((l = n.sibling), (n.sibling = null)),
          Wo(t, !1, l, n, o));
        break;
      case 'backwards':
        for (n = null, l = t.child, t.child = null; l !== null;) {
          if (((e = l.alternate), e !== null && Wl(e) === null)) {
            t.child = l;
            break;
          }
          ((e = l.sibling), (l.sibling = n), (n = l), (l = e));
        }
        Wo(t, !0, n, null, o);
        break;
      case 'together':
        Wo(t, !1, null, null, void 0);
        break;
      default:
        t.memoizedState = null;
    }
  return t.child;
}
function wl(e, t) {
  !(t.mode & 1) && e !== null && ((e.alternate = null), (t.alternate = null), (t.flags |= 2));
}
function pt(e, t, n) {
  if ((e !== null && (t.dependencies = e.dependencies), (rn |= t.lanes), !(n & t.childLanes)))
    return null;
  if (e !== null && t.child !== e.child) throw Error(w(153));
  if (t.child !== null) {
    for (e = t.child, n = zt(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;)
      ((e = e.sibling), (n = n.sibling = zt(e, e.pendingProps)), (n.return = t));
    n.sibling = null;
  }
  return t.child;
}
function Fm(e, t, n) {
  switch (t.tag) {
    case 3:
      (md(t), zn());
      break;
    case 5:
      Vc(t);
      break;
    case 1:
      we(t.type) && Fl(t);
      break;
    case 4:
      Ei(t, t.stateNode.containerInfo);
      break;
    case 10:
      var r = t.type._context,
        l = t.memoizedProps.value;
      (U(Ul, r._currentValue), (r._currentValue = l));
      break;
    case 13:
      if (((r = t.memoizedState), r !== null))
        return r.dehydrated !== null
          ? (U(Q, Q.current & 1), (t.flags |= 128), null)
          : n & t.child.childLanes
            ? hd(e, t, n)
            : (U(Q, Q.current & 1), (e = pt(e, t, n)), e !== null ? e.sibling : null);
      U(Q, Q.current & 1);
      break;
    case 19:
      if (((r = (n & t.childLanes) !== 0), e.flags & 128)) {
        if (r) return vd(e, t, n);
        t.flags |= 128;
      }
      if (
        ((l = t.memoizedState),
        l !== null && ((l.rendering = null), (l.tail = null), (l.lastEffect = null)),
        U(Q, Q.current),
        r)
      )
        break;
      return null;
    case 22:
    case 23:
      return ((t.lanes = 0), fd(e, t, n));
  }
  return pt(e, t, n);
}
var gd, La, yd, xd;
gd = function (e, t) {
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
La = function () {};
yd = function (e, t, n, r) {
  var l = e.memoizedProps;
  if (l !== r) {
    ((e = t.stateNode), Yt(tt.current));
    var o = null;
    switch (n) {
      case 'input':
        ((l = qo(e, l)), (r = qo(e, r)), (o = []));
        break;
      case 'select':
        ((l = b({}, l, { value: void 0 })), (r = b({}, r, { value: void 0 })), (o = []));
        break;
      case 'textarea':
        ((l = na(e, l)), (r = na(e, r)), (o = []));
        break;
      default:
        typeof l.onClick != 'function' && typeof r.onClick == 'function' && (e.onclick = Il);
    }
    la(n, r);
    var a;
    n = null;
    for (c in l)
      if (!r.hasOwnProperty(c) && l.hasOwnProperty(c) && l[c] != null)
        if (c === 'style') {
          var i = l[c];
          for (a in i) i.hasOwnProperty(a) && (n || (n = {}), (n[a] = ''));
        } else
          c !== 'dangerouslySetInnerHTML' &&
            c !== 'children' &&
            c !== 'suppressContentEditableWarning' &&
            c !== 'suppressHydrationWarning' &&
            c !== 'autoFocus' &&
            (gr.hasOwnProperty(c) ? o || (o = []) : (o = o || []).push(c, null));
    for (c in r) {
      var u = r[c];
      if (
        ((i = l != null ? l[c] : void 0),
        r.hasOwnProperty(c) && u !== i && (u != null || i != null))
      )
        if (c === 'style')
          if (i) {
            for (a in i)
              !i.hasOwnProperty(a) || (u && u.hasOwnProperty(a)) || (n || (n = {}), (n[a] = ''));
            for (a in u) u.hasOwnProperty(a) && i[a] !== u[a] && (n || (n = {}), (n[a] = u[a]));
          } else (n || (o || (o = []), o.push(c, n)), (n = u));
        else
          c === 'dangerouslySetInnerHTML'
            ? ((u = u ? u.__html : void 0),
              (i = i ? i.__html : void 0),
              u != null && i !== u && (o = o || []).push(c, u))
            : c === 'children'
              ? (typeof u != 'string' && typeof u != 'number') || (o = o || []).push(c, '' + u)
              : c !== 'suppressContentEditableWarning' &&
                c !== 'suppressHydrationWarning' &&
                (gr.hasOwnProperty(c)
                  ? (u != null && c === 'onScroll' && V('scroll', e), o || i === u || (o = []))
                  : (o = o || []).push(c, u));
    }
    n && (o = o || []).push('style', n);
    var c = o;
    (t.updateQueue = c) && (t.flags |= 4);
  }
};
xd = function (e, t, n, r) {
  n !== r && (t.flags |= 4);
};
function tr(e, t) {
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
function ce(e) {
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
function $m(e, t, n) {
  var r = t.pendingProps;
  switch ((vi(t), t.tag)) {
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
      return (ce(t), null);
    case 1:
      return (we(t.type) && Ml(), ce(t), null);
    case 3:
      return (
        (r = t.stateNode),
        Mn(),
        W(Se),
        W(pe),
        Ni(),
        r.pendingContext && ((r.context = r.pendingContext), (r.pendingContext = null)),
        (e === null || e.child === null) &&
          (ol(t)
            ? (t.flags |= 4)
            : e === null ||
              (e.memoizedState.isDehydrated && !(t.flags & 256)) ||
              ((t.flags |= 1024), He !== null && (Aa(He), (He = null)))),
        La(e, t),
        ce(t),
        null
      );
    case 5:
      ji(t);
      var l = Yt(Tr.current);
      if (((n = t.type), e !== null && t.stateNode != null))
        (yd(e, t, n, r, l), e.ref !== t.ref && ((t.flags |= 512), (t.flags |= 2097152)));
      else {
        if (!r) {
          if (t.stateNode === null) throw Error(w(166));
          return (ce(t), null);
        }
        if (((e = Yt(tt.current)), ol(t))) {
          ((r = t.stateNode), (n = t.type));
          var o = t.memoizedProps;
          switch (((r[Ze] = t), (r[_r] = o), (e = (t.mode & 1) !== 0), n)) {
            case 'dialog':
              (V('cancel', r), V('close', r));
              break;
            case 'iframe':
            case 'object':
            case 'embed':
              V('load', r);
              break;
            case 'video':
            case 'audio':
              for (l = 0; l < ir.length; l++) V(ir[l], r);
              break;
            case 'source':
              V('error', r);
              break;
            case 'img':
            case 'image':
            case 'link':
              (V('error', r), V('load', r));
              break;
            case 'details':
              V('toggle', r);
              break;
            case 'input':
              (is(r, o), V('invalid', r));
              break;
            case 'select':
              ((r._wrapperState = { wasMultiple: !!o.multiple }), V('invalid', r));
              break;
            case 'textarea':
              (us(r, o), V('invalid', r));
          }
          (la(n, o), (l = null));
          for (var a in o)
            if (o.hasOwnProperty(a)) {
              var i = o[a];
              a === 'children'
                ? typeof i == 'string'
                  ? r.textContent !== i &&
                    (o.suppressHydrationWarning !== !0 && ll(r.textContent, i, e),
                    (l = ['children', i]))
                  : typeof i == 'number' &&
                    r.textContent !== '' + i &&
                    (o.suppressHydrationWarning !== !0 && ll(r.textContent, i, e),
                    (l = ['children', '' + i]))
                : gr.hasOwnProperty(a) && i != null && a === 'onScroll' && V('scroll', r);
            }
          switch (n) {
            case 'input':
              (Xr(r), ss(r, o, !0));
              break;
            case 'textarea':
              (Xr(r), cs(r));
              break;
            case 'select':
            case 'option':
              break;
            default:
              typeof o.onClick == 'function' && (r.onclick = Il);
          }
          ((r = l), (t.updateQueue = r), r !== null && (t.flags |= 4));
        } else {
          ((a = l.nodeType === 9 ? l : l.ownerDocument),
            e === 'http://www.w3.org/1999/xhtml' && (e = bu(n)),
            e === 'http://www.w3.org/1999/xhtml'
              ? n === 'script'
                ? ((e = a.createElement('div')),
                  (e.innerHTML = '<script><\/script>'),
                  (e = e.removeChild(e.firstChild)))
                : typeof r.is == 'string'
                  ? (e = a.createElement(n, { is: r.is }))
                  : ((e = a.createElement(n)),
                    n === 'select' &&
                      ((a = e), r.multiple ? (a.multiple = !0) : r.size && (a.size = r.size)))
              : (e = a.createElementNS(e, n)),
            (e[Ze] = t),
            (e[_r] = r),
            gd(e, t, !1, !1),
            (t.stateNode = e));
          e: {
            switch (((a = oa(n, r)), n)) {
              case 'dialog':
                (V('cancel', e), V('close', e), (l = r));
                break;
              case 'iframe':
              case 'object':
              case 'embed':
                (V('load', e), (l = r));
                break;
              case 'video':
              case 'audio':
                for (l = 0; l < ir.length; l++) V(ir[l], e);
                l = r;
                break;
              case 'source':
                (V('error', e), (l = r));
                break;
              case 'img':
              case 'image':
              case 'link':
                (V('error', e), V('load', e), (l = r));
                break;
              case 'details':
                (V('toggle', e), (l = r));
                break;
              case 'input':
                (is(e, r), (l = qo(e, r)), V('invalid', e));
                break;
              case 'option':
                l = r;
                break;
              case 'select':
                ((e._wrapperState = { wasMultiple: !!r.multiple }),
                  (l = b({}, r, { value: void 0 })),
                  V('invalid', e));
                break;
              case 'textarea':
                (us(e, r), (l = na(e, r)), V('invalid', e));
                break;
              default:
                l = r;
            }
            (la(n, l), (i = l));
            for (o in i)
              if (i.hasOwnProperty(o)) {
                var u = i[o];
                o === 'style'
                  ? Xu(e, u)
                  : o === 'dangerouslySetInnerHTML'
                    ? ((u = u ? u.__html : void 0), u != null && Yu(e, u))
                    : o === 'children'
                      ? typeof u == 'string'
                        ? (n !== 'textarea' || u !== '') && yr(e, u)
                        : typeof u == 'number' && yr(e, '' + u)
                      : o !== 'suppressContentEditableWarning' &&
                        o !== 'suppressHydrationWarning' &&
                        o !== 'autoFocus' &&
                        (gr.hasOwnProperty(o)
                          ? u != null && o === 'onScroll' && V('scroll', e)
                          : u != null && ti(e, o, u, a));
              }
            switch (n) {
              case 'input':
                (Xr(e), ss(e, r, !1));
                break;
              case 'textarea':
                (Xr(e), cs(e));
                break;
              case 'option':
                r.value != null && e.setAttribute('value', '' + It(r.value));
                break;
              case 'select':
                ((e.multiple = !!r.multiple),
                  (o = r.value),
                  o != null
                    ? Cn(e, !!r.multiple, o, !1)
                    : r.defaultValue != null && Cn(e, !!r.multiple, r.defaultValue, !0));
                break;
              default:
                typeof l.onClick == 'function' && (e.onclick = Il);
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
      return (ce(t), null);
    case 6:
      if (e && t.stateNode != null) xd(e, t, e.memoizedProps, r);
      else {
        if (typeof r != 'string' && t.stateNode === null) throw Error(w(166));
        if (((n = Yt(Tr.current)), Yt(tt.current), ol(t))) {
          if (
            ((r = t.stateNode),
            (n = t.memoizedProps),
            (r[Ze] = t),
            (o = r.nodeValue !== n) && ((e = Pe), e !== null))
          )
            switch (e.tag) {
              case 3:
                ll(r.nodeValue, n, (e.mode & 1) !== 0);
                break;
              case 5:
                e.memoizedProps.suppressHydrationWarning !== !0 &&
                  ll(r.nodeValue, n, (e.mode & 1) !== 0);
            }
          o && (t.flags |= 4);
        } else
          ((r = (n.nodeType === 9 ? n : n.ownerDocument).createTextNode(r)),
            (r[Ze] = t),
            (t.stateNode = r));
      }
      return (ce(t), null);
    case 13:
      if (
        (W(Q),
        (r = t.memoizedState),
        e === null || (e.memoizedState !== null && e.memoizedState.dehydrated !== null))
      ) {
        if (H && _e !== null && t.mode & 1 && !(t.flags & 128))
          (Fc(), zn(), (t.flags |= 98560), (o = !1));
        else if (((o = ol(t)), r !== null && r.dehydrated !== null)) {
          if (e === null) {
            if (!o) throw Error(w(318));
            if (((o = t.memoizedState), (o = o !== null ? o.dehydrated : null), !o))
              throw Error(w(317));
            o[Ze] = t;
          } else (zn(), !(t.flags & 128) && (t.memoizedState = null), (t.flags |= 4));
          (ce(t), (o = !1));
        } else (He !== null && (Aa(He), (He = null)), (o = !0));
        if (!o) return t.flags & 65536 ? t : null;
      }
      return t.flags & 128
        ? ((t.lanes = n), t)
        : ((r = r !== null),
          r !== (e !== null && e.memoizedState !== null) &&
            r &&
            ((t.child.flags |= 8192),
            t.mode & 1 && (e === null || Q.current & 1 ? ne === 0 && (ne = 3) : Fi())),
          t.updateQueue !== null && (t.flags |= 4),
          ce(t),
          null);
    case 4:
      return (Mn(), La(e, t), e === null && Nr(t.stateNode.containerInfo), ce(t), null);
    case 10:
      return (ki(t.type._context), ce(t), null);
    case 17:
      return (we(t.type) && Ml(), ce(t), null);
    case 19:
      if ((W(Q), (o = t.memoizedState), o === null)) return (ce(t), null);
      if (((r = (t.flags & 128) !== 0), (a = o.rendering), a === null))
        if (r) tr(o, !1);
        else {
          if (ne !== 0 || (e !== null && e.flags & 128))
            for (e = t.child; e !== null;) {
              if (((a = Wl(e)), a !== null)) {
                for (
                  t.flags |= 128,
                    tr(o, !1),
                    r = a.updateQueue,
                    r !== null && ((t.updateQueue = r), (t.flags |= 4)),
                    t.subtreeFlags = 0,
                    r = n,
                    n = t.child;
                  n !== null;
                )
                  ((o = n),
                    (e = r),
                    (o.flags &= 14680066),
                    (a = o.alternate),
                    a === null
                      ? ((o.childLanes = 0),
                        (o.lanes = e),
                        (o.child = null),
                        (o.subtreeFlags = 0),
                        (o.memoizedProps = null),
                        (o.memoizedState = null),
                        (o.updateQueue = null),
                        (o.dependencies = null),
                        (o.stateNode = null))
                      : ((o.childLanes = a.childLanes),
                        (o.lanes = a.lanes),
                        (o.child = a.child),
                        (o.subtreeFlags = 0),
                        (o.deletions = null),
                        (o.memoizedProps = a.memoizedProps),
                        (o.memoizedState = a.memoizedState),
                        (o.updateQueue = a.updateQueue),
                        (o.type = a.type),
                        (e = a.dependencies),
                        (o.dependencies =
                          e === null ? null : { lanes: e.lanes, firstContext: e.firstContext })),
                    (n = n.sibling));
                return (U(Q, (Q.current & 1) | 2), t.child);
              }
              e = e.sibling;
            }
          o.tail !== null &&
            X() > $n &&
            ((t.flags |= 128), (r = !0), tr(o, !1), (t.lanes = 4194304));
        }
      else {
        if (!r)
          if (((e = Wl(a)), e !== null)) {
            if (
              ((t.flags |= 128),
              (r = !0),
              (n = e.updateQueue),
              n !== null && ((t.updateQueue = n), (t.flags |= 4)),
              tr(o, !0),
              o.tail === null && o.tailMode === 'hidden' && !a.alternate && !H)
            )
              return (ce(t), null);
          } else
            2 * X() - o.renderingStartTime > $n &&
              n !== 1073741824 &&
              ((t.flags |= 128), (r = !0), tr(o, !1), (t.lanes = 4194304));
        o.isBackwards
          ? ((a.sibling = t.child), (t.child = a))
          : ((n = o.last), n !== null ? (n.sibling = a) : (t.child = a), (o.last = a));
      }
      return o.tail !== null
        ? ((t = o.tail),
          (o.rendering = t),
          (o.tail = t.sibling),
          (o.renderingStartTime = X()),
          (t.sibling = null),
          (n = Q.current),
          U(Q, r ? (n & 1) | 2 : n & 1),
          t)
        : (ce(t), null);
    case 22:
    case 23:
      return (
        Mi(),
        (r = t.memoizedState !== null),
        e !== null && (e.memoizedState !== null) !== r && (t.flags |= 8192),
        r && t.mode & 1
          ? Ce & 1073741824 && (ce(t), t.subtreeFlags & 6 && (t.flags |= 8192))
          : ce(t),
        null
      );
    case 24:
      return null;
    case 25:
      return null;
  }
  throw Error(w(156, t.tag));
}
function Am(e, t) {
  switch ((vi(t), t.tag)) {
    case 1:
      return (
        we(t.type) && Ml(),
        (e = t.flags),
        e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null
      );
    case 3:
      return (
        Mn(),
        W(Se),
        W(pe),
        Ni(),
        (e = t.flags),
        e & 65536 && !(e & 128) ? ((t.flags = (e & -65537) | 128), t) : null
      );
    case 5:
      return (ji(t), null);
    case 13:
      if ((W(Q), (e = t.memoizedState), e !== null && e.dehydrated !== null)) {
        if (t.alternate === null) throw Error(w(340));
        zn();
      }
      return ((e = t.flags), e & 65536 ? ((t.flags = (e & -65537) | 128), t) : null);
    case 19:
      return (W(Q), null);
    case 4:
      return (Mn(), null);
    case 10:
      return (ki(t.type._context), null);
    case 22:
    case 23:
      return (Mi(), null);
    case 24:
      return null;
    default:
      return null;
  }
}
var sl = !1,
  fe = !1,
  Um = typeof WeakSet == 'function' ? WeakSet : Set,
  C = null;
function jn(e, t) {
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
function Ra(e, t, n) {
  try {
    n();
  } catch (r) {
    Y(e, t, r);
  }
}
var qs = !1;
function Bm(e, t) {
  if (((ha = Rl), (e = jc()), mi(e))) {
    if ('selectionStart' in e) var n = { start: e.selectionStart, end: e.selectionEnd };
    else
      e: {
        n = ((n = e.ownerDocument) && n.defaultView) || window;
        var r = n.getSelection && n.getSelection();
        if (r && r.rangeCount !== 0) {
          n = r.anchorNode;
          var l = r.anchorOffset,
            o = r.focusNode;
          r = r.focusOffset;
          try {
            (n.nodeType, o.nodeType);
          } catch {
            n = null;
            break e;
          }
          var a = 0,
            i = -1,
            u = -1,
            c = 0,
            m = 0,
            d = e,
            f = null;
          t: for (;;) {
            for (
              var y;
              d !== n || (l !== 0 && d.nodeType !== 3) || (i = a + l),
                d !== o || (r !== 0 && d.nodeType !== 3) || (u = a + r),
                d.nodeType === 3 && (a += d.nodeValue.length),
                (y = d.firstChild) !== null;
            )
              ((f = d), (d = y));
            for (;;) {
              if (d === e) break t;
              if (
                (f === n && ++c === l && (i = a),
                f === o && ++m === r && (u = a),
                (y = d.nextSibling) !== null)
              )
                break;
              ((d = f), (f = d.parentNode));
            }
            d = y;
          }
          n = i === -1 || u === -1 ? null : { start: i, end: u };
        } else n = null;
      }
    n = n || { start: 0, end: 0 };
  } else n = null;
  for (va = { focusedElem: e, selectionRange: n }, Rl = !1, C = t; C !== null;)
    if (((t = C), (e = t.child), (t.subtreeFlags & 1028) !== 0 && e !== null))
      ((e.return = t), (C = e));
    else
      for (; C !== null;) {
        t = C;
        try {
          var S = t.alternate;
          if (t.flags & 1024)
            switch (t.tag) {
              case 0:
              case 11:
              case 15:
                break;
              case 1:
                if (S !== null) {
                  var x = S.memoizedProps,
                    E = S.memoizedState,
                    h = t.stateNode,
                    p = h.getSnapshotBeforeUpdate(t.elementType === t.type ? x : Ve(t.type, x), E);
                  h.__reactInternalSnapshotBeforeUpdate = p;
                }
                break;
              case 3:
                var v = t.stateNode.containerInfo;
                v.nodeType === 1
                  ? (v.textContent = '')
                  : v.nodeType === 9 && v.documentElement && v.removeChild(v.documentElement);
                break;
              case 5:
              case 6:
              case 4:
              case 17:
                break;
              default:
                throw Error(w(163));
            }
        } catch (k) {
          Y(t, t.return, k);
        }
        if (((e = t.sibling), e !== null)) {
          ((e.return = t.return), (C = e));
          break;
        }
        C = t.return;
      }
  return ((S = qs), (qs = !1), S);
}
function mr(e, t, n) {
  var r = t.updateQueue;
  if (((r = r !== null ? r.lastEffect : null), r !== null)) {
    var l = (r = r.next);
    do {
      if ((l.tag & e) === e) {
        var o = l.destroy;
        ((l.destroy = void 0), o !== void 0 && Ra(t, n, o));
      }
      l = l.next;
    } while (l !== r);
  }
}
function ao(e, t) {
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
function Da(e) {
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
function kd(e) {
  var t = e.alternate;
  (t !== null && ((e.alternate = null), kd(t)),
    (e.child = null),
    (e.deletions = null),
    (e.sibling = null),
    e.tag === 5 &&
      ((t = e.stateNode),
      t !== null && (delete t[Ze], delete t[_r], delete t[xa], delete t[Em], delete t[jm])),
    (e.stateNode = null),
    (e.return = null),
    (e.dependencies = null),
    (e.memoizedProps = null),
    (e.memoizedState = null),
    (e.pendingProps = null),
    (e.stateNode = null),
    (e.updateQueue = null));
}
function Sd(e) {
  return e.tag === 5 || e.tag === 3 || e.tag === 4;
}
function eu(e) {
  e: for (;;) {
    for (; e.sibling === null;) {
      if (e.return === null || Sd(e.return)) return null;
      e = e.return;
    }
    for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
      if (e.flags & 2 || e.child === null || e.tag === 4) continue e;
      ((e.child.return = e), (e = e.child));
    }
    if (!(e.flags & 2)) return e.stateNode;
  }
}
function za(e, t, n) {
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
          n != null || t.onclick !== null || (t.onclick = Il)));
  else if (r !== 4 && ((e = e.child), e !== null))
    for (za(e, t, n), e = e.sibling; e !== null;) (za(e, t, n), (e = e.sibling));
}
function Ia(e, t, n) {
  var r = e.tag;
  if (r === 5 || r === 6) ((e = e.stateNode), t ? n.insertBefore(e, t) : n.appendChild(e));
  else if (r !== 4 && ((e = e.child), e !== null))
    for (Ia(e, t, n), e = e.sibling; e !== null;) (Ia(e, t, n), (e = e.sibling));
}
var ae = null,
  We = !1;
function yt(e, t, n) {
  for (n = n.child; n !== null;) (wd(e, t, n), (n = n.sibling));
}
function wd(e, t, n) {
  if (et && typeof et.onCommitFiberUnmount == 'function')
    try {
      et.onCommitFiberUnmount(Zl, n);
    } catch {}
  switch (n.tag) {
    case 5:
      fe || jn(n, t);
    case 6:
      var r = ae,
        l = We;
      ((ae = null),
        yt(e, t, n),
        (ae = r),
        (We = l),
        ae !== null &&
          (We
            ? ((e = ae),
              (n = n.stateNode),
              e.nodeType === 8 ? e.parentNode.removeChild(n) : e.removeChild(n))
            : ae.removeChild(n.stateNode)));
      break;
    case 18:
      ae !== null &&
        (We
          ? ((e = ae),
            (n = n.stateNode),
            e.nodeType === 8 ? Mo(e.parentNode, n) : e.nodeType === 1 && Mo(e, n),
            wr(e))
          : Mo(ae, n.stateNode));
      break;
    case 4:
      ((r = ae),
        (l = We),
        (ae = n.stateNode.containerInfo),
        (We = !0),
        yt(e, t, n),
        (ae = r),
        (We = l));
      break;
    case 0:
    case 11:
    case 14:
    case 15:
      if (!fe && ((r = n.updateQueue), r !== null && ((r = r.lastEffect), r !== null))) {
        l = r = r.next;
        do {
          var o = l,
            a = o.destroy;
          ((o = o.tag), a !== void 0 && (o & 2 || o & 4) && Ra(n, t, a), (l = l.next));
        } while (l !== r);
      }
      yt(e, t, n);
      break;
    case 1:
      if (!fe && (jn(n, t), (r = n.stateNode), typeof r.componentWillUnmount == 'function'))
        try {
          ((r.props = n.memoizedProps), (r.state = n.memoizedState), r.componentWillUnmount());
        } catch (i) {
          Y(n, t, i);
        }
      yt(e, t, n);
      break;
    case 21:
      yt(e, t, n);
      break;
    case 22:
      n.mode & 1
        ? ((fe = (r = fe) || n.memoizedState !== null), yt(e, t, n), (fe = r))
        : yt(e, t, n);
      break;
    default:
      yt(e, t, n);
  }
}
function tu(e) {
  var t = e.updateQueue;
  if (t !== null) {
    e.updateQueue = null;
    var n = e.stateNode;
    (n === null && (n = e.stateNode = new Um()),
      t.forEach(function (r) {
        var l = Xm.bind(null, e, r);
        n.has(r) || (n.add(r), r.then(l, l));
      }));
  }
}
function Be(e, t) {
  var n = t.deletions;
  if (n !== null)
    for (var r = 0; r < n.length; r++) {
      var l = n[r];
      try {
        var o = e,
          a = t,
          i = a;
        e: for (; i !== null;) {
          switch (i.tag) {
            case 5:
              ((ae = i.stateNode), (We = !1));
              break e;
            case 3:
              ((ae = i.stateNode.containerInfo), (We = !0));
              break e;
            case 4:
              ((ae = i.stateNode.containerInfo), (We = !0));
              break e;
          }
          i = i.return;
        }
        if (ae === null) throw Error(w(160));
        (wd(o, a, l), (ae = null), (We = !1));
        var u = l.alternate;
        (u !== null && (u.return = null), (l.return = null));
      } catch (c) {
        Y(l, t, c);
      }
    }
  if (t.subtreeFlags & 12854) for (t = t.child; t !== null;) (Ed(t, e), (t = t.sibling));
}
function Ed(e, t) {
  var n = e.alternate,
    r = e.flags;
  switch (e.tag) {
    case 0:
    case 11:
    case 14:
    case 15:
      if ((Be(t, e), Xe(e), r & 4)) {
        try {
          (mr(3, e, e.return), ao(3, e));
        } catch (x) {
          Y(e, e.return, x);
        }
        try {
          mr(5, e, e.return);
        } catch (x) {
          Y(e, e.return, x);
        }
      }
      break;
    case 1:
      (Be(t, e), Xe(e), r & 512 && n !== null && jn(n, n.return));
      break;
    case 5:
      if ((Be(t, e), Xe(e), r & 512 && n !== null && jn(n, n.return), e.flags & 32)) {
        var l = e.stateNode;
        try {
          yr(l, '');
        } catch (x) {
          Y(e, e.return, x);
        }
      }
      if (r & 4 && ((l = e.stateNode), l != null)) {
        var o = e.memoizedProps,
          a = n !== null ? n.memoizedProps : o,
          i = e.type,
          u = e.updateQueue;
        if (((e.updateQueue = null), u !== null))
          try {
            (i === 'input' && o.type === 'radio' && o.name != null && Qu(l, o), oa(i, a));
            var c = oa(i, o);
            for (a = 0; a < u.length; a += 2) {
              var m = u[a],
                d = u[a + 1];
              m === 'style'
                ? Xu(l, d)
                : m === 'dangerouslySetInnerHTML'
                  ? Yu(l, d)
                  : m === 'children'
                    ? yr(l, d)
                    : ti(l, m, d, c);
            }
            switch (i) {
              case 'input':
                ea(l, o);
                break;
              case 'textarea':
                Ku(l, o);
                break;
              case 'select':
                var f = l._wrapperState.wasMultiple;
                l._wrapperState.wasMultiple = !!o.multiple;
                var y = o.value;
                y != null
                  ? Cn(l, !!o.multiple, y, !1)
                  : f !== !!o.multiple &&
                    (o.defaultValue != null
                      ? Cn(l, !!o.multiple, o.defaultValue, !0)
                      : Cn(l, !!o.multiple, o.multiple ? [] : '', !1));
            }
            l[_r] = o;
          } catch (x) {
            Y(e, e.return, x);
          }
      }
      break;
    case 6:
      if ((Be(t, e), Xe(e), r & 4)) {
        if (e.stateNode === null) throw Error(w(162));
        ((l = e.stateNode), (o = e.memoizedProps));
        try {
          l.nodeValue = o;
        } catch (x) {
          Y(e, e.return, x);
        }
      }
      break;
    case 3:
      if ((Be(t, e), Xe(e), r & 4 && n !== null && n.memoizedState.isDehydrated))
        try {
          wr(t.containerInfo);
        } catch (x) {
          Y(e, e.return, x);
        }
      break;
    case 4:
      (Be(t, e), Xe(e));
      break;
    case 13:
      (Be(t, e),
        Xe(e),
        (l = e.child),
        l.flags & 8192 &&
          ((o = l.memoizedState !== null),
          (l.stateNode.isHidden = o),
          !o || (l.alternate !== null && l.alternate.memoizedState !== null) || (zi = X())),
        r & 4 && tu(e));
      break;
    case 22:
      if (
        ((m = n !== null && n.memoizedState !== null),
        e.mode & 1 ? ((fe = (c = fe) || m), Be(t, e), (fe = c)) : Be(t, e),
        Xe(e),
        r & 8192)
      ) {
        if (((c = e.memoizedState !== null), (e.stateNode.isHidden = c) && !m && e.mode & 1))
          for (C = e, m = e.child; m !== null;) {
            for (d = C = m; C !== null;) {
              switch (((f = C), (y = f.child), f.tag)) {
                case 0:
                case 11:
                case 14:
                case 15:
                  mr(4, f, f.return);
                  break;
                case 1:
                  jn(f, f.return);
                  var S = f.stateNode;
                  if (typeof S.componentWillUnmount == 'function') {
                    ((r = f), (n = f.return));
                    try {
                      ((t = r),
                        (S.props = t.memoizedProps),
                        (S.state = t.memoizedState),
                        S.componentWillUnmount());
                    } catch (x) {
                      Y(r, n, x);
                    }
                  }
                  break;
                case 5:
                  jn(f, f.return);
                  break;
                case 22:
                  if (f.memoizedState !== null) {
                    ru(d);
                    continue;
                  }
              }
              y !== null ? ((y.return = f), (C = y)) : ru(d);
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
                    ? ((o = l.style),
                      typeof o.setProperty == 'function'
                        ? o.setProperty('display', 'none', 'important')
                        : (o.display = 'none'))
                    : ((i = d.stateNode),
                      (u = d.memoizedProps.style),
                      (a = u != null && u.hasOwnProperty('display') ? u.display : null),
                      (i.style.display = Gu('display', a))));
              } catch (x) {
                Y(e, e.return, x);
              }
            }
          } else if (d.tag === 6) {
            if (m === null)
              try {
                d.stateNode.nodeValue = c ? '' : d.memoizedProps;
              } catch (x) {
                Y(e, e.return, x);
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
      (Be(t, e), Xe(e), r & 4 && tu(e));
      break;
    case 21:
      break;
    default:
      (Be(t, e), Xe(e));
  }
}
function Xe(e) {
  var t = e.flags;
  if (t & 2) {
    try {
      e: {
        for (var n = e.return; n !== null;) {
          if (Sd(n)) {
            var r = n;
            break e;
          }
          n = n.return;
        }
        throw Error(w(160));
      }
      switch (r.tag) {
        case 5:
          var l = r.stateNode;
          r.flags & 32 && (yr(l, ''), (r.flags &= -33));
          var o = eu(e);
          Ia(e, o, l);
          break;
        case 3:
        case 4:
          var a = r.stateNode.containerInfo,
            i = eu(e);
          za(e, i, a);
          break;
        default:
          throw Error(w(161));
      }
    } catch (u) {
      Y(e, e.return, u);
    }
    e.flags &= -3;
  }
  t & 4096 && (e.flags &= -4097);
}
function Vm(e, t, n) {
  ((C = e), jd(e));
}
function jd(e, t, n) {
  for (var r = (e.mode & 1) !== 0; C !== null;) {
    var l = C,
      o = l.child;
    if (l.tag === 22 && r) {
      var a = l.memoizedState !== null || sl;
      if (!a) {
        var i = l.alternate,
          u = (i !== null && i.memoizedState !== null) || fe;
        i = sl;
        var c = fe;
        if (((sl = a), (fe = u) && !c))
          for (C = l; C !== null;)
            ((a = C),
              (u = a.child),
              a.tag === 22 && a.memoizedState !== null
                ? lu(l)
                : u !== null
                  ? ((u.return = a), (C = u))
                  : lu(l));
        for (; o !== null;) ((C = o), jd(o), (o = o.sibling));
        ((C = l), (sl = i), (fe = c));
      }
      nu(e);
    } else l.subtreeFlags & 8772 && o !== null ? ((o.return = l), (C = o)) : nu(e);
  }
}
function nu(e) {
  for (; C !== null;) {
    var t = C;
    if (t.flags & 8772) {
      var n = t.alternate;
      try {
        if (t.flags & 8772)
          switch (t.tag) {
            case 0:
            case 11:
            case 15:
              fe || ao(5, t);
              break;
            case 1:
              var r = t.stateNode;
              if (t.flags & 4 && !fe)
                if (n === null) r.componentDidMount();
                else {
                  var l = t.elementType === t.type ? n.memoizedProps : Ve(t.type, n.memoizedProps);
                  r.componentDidUpdate(l, n.memoizedState, r.__reactInternalSnapshotBeforeUpdate);
                }
              var o = t.updateQueue;
              o !== null && Us(t, o, r);
              break;
            case 3:
              var a = t.updateQueue;
              if (a !== null) {
                if (((n = null), t.child !== null))
                  switch (t.child.tag) {
                    case 5:
                      n = t.child.stateNode;
                      break;
                    case 1:
                      n = t.child.stateNode;
                  }
                Us(t, a, n);
              }
              break;
            case 5:
              var i = t.stateNode;
              if (n === null && t.flags & 4) {
                n = i;
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
                    d !== null && wr(d);
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
              throw Error(w(163));
          }
        fe || (t.flags & 512 && Da(t));
      } catch (f) {
        Y(t, t.return, f);
      }
    }
    if (t === e) {
      C = null;
      break;
    }
    if (((n = t.sibling), n !== null)) {
      ((n.return = t.return), (C = n));
      break;
    }
    C = t.return;
  }
}
function ru(e) {
  for (; C !== null;) {
    var t = C;
    if (t === e) {
      C = null;
      break;
    }
    var n = t.sibling;
    if (n !== null) {
      ((n.return = t.return), (C = n));
      break;
    }
    C = t.return;
  }
}
function lu(e) {
  for (; C !== null;) {
    var t = C;
    try {
      switch (t.tag) {
        case 0:
        case 11:
        case 15:
          var n = t.return;
          try {
            ao(4, t);
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
          var o = t.return;
          try {
            Da(t);
          } catch (u) {
            Y(t, o, u);
          }
          break;
        case 5:
          var a = t.return;
          try {
            Da(t);
          } catch (u) {
            Y(t, a, u);
          }
      }
    } catch (u) {
      Y(t, t.return, u);
    }
    if (t === e) {
      C = null;
      break;
    }
    var i = t.sibling;
    if (i !== null) {
      ((i.return = t.return), (C = i));
      break;
    }
    C = t.return;
  }
}
var Wm = Math.ceil,
  Kl = ht.ReactCurrentDispatcher,
  Ri = ht.ReactCurrentOwner,
  Fe = ht.ReactCurrentBatchConfig,
  z = 0,
  oe = null,
  Z = null,
  ie = 0,
  Ce = 0,
  Nn = At(0),
  ne = 0,
  Dr = null,
  rn = 0,
  io = 0,
  Di = 0,
  hr = null,
  xe = null,
  zi = 0,
  $n = 1 / 0,
  ot = null,
  bl = !1,
  Ma = null,
  Rt = null,
  ul = !1,
  Nt = null,
  Yl = 0,
  vr = 0,
  Fa = null,
  El = -1,
  jl = 0;
function he() {
  return z & 6 ? X() : El !== -1 ? El : (El = X());
}
function Dt(e) {
  return e.mode & 1
    ? z & 2 && ie !== 0
      ? ie & -ie
      : Cm.transition !== null
        ? (jl === 0 && (jl = sc()), jl)
        : ((e = M), e !== 0 || ((e = window.event), (e = e === void 0 ? 16 : hc(e.type))), e)
    : 1;
}
function Ke(e, t, n, r) {
  if (50 < vr) throw ((vr = 0), (Fa = null), Error(w(185)));
  (Ur(e, n, r),
    (!(z & 2) || e !== oe) &&
      (e === oe && (!(z & 2) && (io |= n), ne === 4 && Et(e, ie)),
      Ee(e, r),
      n === 1 && z === 0 && !(t.mode & 1) && (($n = X() + 500), ro && Ut())));
}
function Ee(e, t) {
  var n = e.callbackNode;
  Cp(e, t);
  var r = Ll(e, e === oe ? ie : 0);
  if (r === 0) (n !== null && ps(n), (e.callbackNode = null), (e.callbackPriority = 0));
  else if (((t = r & -r), e.callbackPriority !== t)) {
    if ((n != null && ps(n), t === 1))
      (e.tag === 0 ? Nm(ou.bind(null, e)) : zc(ou.bind(null, e)),
        Sm(function () {
          !(z & 6) && Ut();
        }),
        (n = null));
    else {
      switch (uc(r)) {
        case 1:
          n = ai;
          break;
        case 4:
          n = ac;
          break;
        case 16:
          n = Ol;
          break;
        case 536870912:
          n = ic;
          break;
        default:
          n = Ol;
      }
      n = Rd(n, Nd.bind(null, e));
    }
    ((e.callbackPriority = t), (e.callbackNode = n));
  }
}
function Nd(e, t) {
  if (((El = -1), (jl = 0), z & 6)) throw Error(w(327));
  var n = e.callbackNode;
  if (Ln() && e.callbackNode !== n) return null;
  var r = Ll(e, e === oe ? ie : 0);
  if (r === 0) return null;
  if (r & 30 || r & e.expiredLanes || t) t = Gl(e, r);
  else {
    t = r;
    var l = z;
    z |= 2;
    var o = _d();
    (oe !== e || ie !== t) && ((ot = null), ($n = X() + 500), Xt(e, t));
    do
      try {
        Km();
        break;
      } catch (i) {
        Cd(e, i);
      }
    while (!0);
    (xi(), (Kl.current = o), (z = l), Z !== null ? (t = 0) : ((oe = null), (ie = 0), (t = ne)));
  }
  if (t !== 0) {
    if ((t === 2 && ((l = ca(e)), l !== 0 && ((r = l), (t = $a(e, l)))), t === 1))
      throw ((n = Dr), Xt(e, 0), Et(e, r), Ee(e, X()), n);
    if (t === 6) Et(e, r);
    else {
      if (
        ((l = e.current.alternate),
        !(r & 30) &&
          !Hm(l) &&
          ((t = Gl(e, r)), t === 2 && ((o = ca(e)), o !== 0 && ((r = o), (t = $a(e, o)))), t === 1))
      )
        throw ((n = Dr), Xt(e, 0), Et(e, r), Ee(e, X()), n);
      switch (((e.finishedWork = l), (e.finishedLanes = r), t)) {
        case 0:
        case 1:
          throw Error(w(345));
        case 2:
          Ht(e, xe, ot);
          break;
        case 3:
          if ((Et(e, r), (r & 130023424) === r && ((t = zi + 500 - X()), 10 < t))) {
            if (Ll(e, 0) !== 0) break;
            if (((l = e.suspendedLanes), (l & r) !== r)) {
              (he(), (e.pingedLanes |= e.suspendedLanes & l));
              break;
            }
            e.timeoutHandle = ya(Ht.bind(null, e, xe, ot), t);
            break;
          }
          Ht(e, xe, ot);
          break;
        case 4:
          if ((Et(e, r), (r & 4194240) === r)) break;
          for (t = e.eventTimes, l = -1; 0 < r;) {
            var a = 31 - Qe(r);
            ((o = 1 << a), (a = t[a]), a > l && (l = a), (r &= ~o));
          }
          if (
            ((r = l),
            (r = X() - r),
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
                          : 1960 * Wm(r / 1960)) - r),
            10 < r)
          ) {
            e.timeoutHandle = ya(Ht.bind(null, e, xe, ot), r);
            break;
          }
          Ht(e, xe, ot);
          break;
        case 5:
          Ht(e, xe, ot);
          break;
        default:
          throw Error(w(329));
      }
    }
  }
  return (Ee(e, X()), e.callbackNode === n ? Nd.bind(null, e) : null);
}
function $a(e, t) {
  var n = hr;
  return (
    e.current.memoizedState.isDehydrated && (Xt(e, t).flags |= 256),
    (e = Gl(e, t)),
    e !== 2 && ((t = xe), (xe = n), t !== null && Aa(t)),
    e
  );
}
function Aa(e) {
  xe === null ? (xe = e) : xe.push.apply(xe, e);
}
function Hm(e) {
  for (var t = e; ;) {
    if (t.flags & 16384) {
      var n = t.updateQueue;
      if (n !== null && ((n = n.stores), n !== null))
        for (var r = 0; r < n.length; r++) {
          var l = n[r],
            o = l.getSnapshot;
          l = l.value;
          try {
            if (!be(o(), l)) return !1;
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
function Et(e, t) {
  for (
    t &= ~Di, t &= ~io, e.suspendedLanes |= t, e.pingedLanes &= ~t, e = e.expirationTimes;
    0 < t;
  ) {
    var n = 31 - Qe(t),
      r = 1 << n;
    ((e[n] = -1), (t &= ~r));
  }
}
function ou(e) {
  if (z & 6) throw Error(w(327));
  Ln();
  var t = Ll(e, 0);
  if (!(t & 1)) return (Ee(e, X()), null);
  var n = Gl(e, t);
  if (e.tag !== 0 && n === 2) {
    var r = ca(e);
    r !== 0 && ((t = r), (n = $a(e, r)));
  }
  if (n === 1) throw ((n = Dr), Xt(e, 0), Et(e, t), Ee(e, X()), n);
  if (n === 6) throw Error(w(345));
  return (
    (e.finishedWork = e.current.alternate),
    (e.finishedLanes = t),
    Ht(e, xe, ot),
    Ee(e, X()),
    null
  );
}
function Ii(e, t) {
  var n = z;
  z |= 1;
  try {
    return e(t);
  } finally {
    ((z = n), z === 0 && (($n = X() + 500), ro && Ut()));
  }
}
function ln(e) {
  Nt !== null && Nt.tag === 0 && !(z & 6) && Ln();
  var t = z;
  z |= 1;
  var n = Fe.transition,
    r = M;
  try {
    if (((Fe.transition = null), (M = 1), e)) return e();
  } finally {
    ((M = r), (Fe.transition = n), (z = t), !(z & 6) && Ut());
  }
}
function Mi() {
  ((Ce = Nn.current), W(Nn));
}
function Xt(e, t) {
  ((e.finishedWork = null), (e.finishedLanes = 0));
  var n = e.timeoutHandle;
  if ((n !== -1 && ((e.timeoutHandle = -1), km(n)), Z !== null))
    for (n = Z.return; n !== null;) {
      var r = n;
      switch ((vi(r), r.tag)) {
        case 1:
          ((r = r.type.childContextTypes), r != null && Ml());
          break;
        case 3:
          (Mn(), W(Se), W(pe), Ni());
          break;
        case 5:
          ji(r);
          break;
        case 4:
          Mn();
          break;
        case 13:
          W(Q);
          break;
        case 19:
          W(Q);
          break;
        case 10:
          ki(r.type._context);
          break;
        case 22:
        case 23:
          Mi();
      }
      n = n.return;
    }
  if (
    ((oe = e),
    (Z = e = zt(e.current, null)),
    (ie = Ce = t),
    (ne = 0),
    (Dr = null),
    (Di = io = rn = 0),
    (xe = hr = null),
    bt !== null)
  ) {
    for (t = 0; t < bt.length; t++)
      if (((n = bt[t]), (r = n.interleaved), r !== null)) {
        n.interleaved = null;
        var l = r.next,
          o = n.pending;
        if (o !== null) {
          var a = o.next;
          ((o.next = l), (r.next = a));
        }
        n.pending = r;
      }
    bt = null;
  }
  return e;
}
function Cd(e, t) {
  do {
    var n = Z;
    try {
      if ((xi(), (kl.current = Ql), Hl)) {
        for (var r = K.memoizedState; r !== null;) {
          var l = r.queue;
          (l !== null && (l.pending = null), (r = r.next));
        }
        Hl = !1;
      }
      if (
        ((nn = 0),
        (re = te = K = null),
        (pr = !1),
        (Or = 0),
        (Ri.current = null),
        n === null || n.return === null)
      ) {
        ((ne = 1), (Dr = t), (Z = null));
        break;
      }
      e: {
        var o = e,
          a = n.return,
          i = n,
          u = t;
        if (
          ((t = ie),
          (i.flags |= 32768),
          u !== null && typeof u == 'object' && typeof u.then == 'function')
        ) {
          var c = u,
            m = i,
            d = m.tag;
          if (!(m.mode & 1) && (d === 0 || d === 11 || d === 15)) {
            var f = m.alternate;
            f
              ? ((m.updateQueue = f.updateQueue),
                (m.memoizedState = f.memoizedState),
                (m.lanes = f.lanes))
              : ((m.updateQueue = null), (m.memoizedState = null));
          }
          var y = Ks(a);
          if (y !== null) {
            ((y.flags &= -257), bs(y, a, i, o, t), y.mode & 1 && Qs(o, c, t), (t = y), (u = c));
            var S = t.updateQueue;
            if (S === null) {
              var x = new Set();
              (x.add(u), (t.updateQueue = x));
            } else S.add(u);
            break e;
          } else {
            if (!(t & 1)) {
              (Qs(o, c, t), Fi());
              break e;
            }
            u = Error(w(426));
          }
        } else if (H && i.mode & 1) {
          var E = Ks(a);
          if (E !== null) {
            (!(E.flags & 65536) && (E.flags |= 256), bs(E, a, i, o, t), gi(Fn(u, i)));
            break e;
          }
        }
        ((o = u = Fn(u, i)), ne !== 4 && (ne = 2), hr === null ? (hr = [o]) : hr.push(o), (o = a));
        do {
          switch (o.tag) {
            case 3:
              ((o.flags |= 65536), (t &= -t), (o.lanes |= t));
              var h = ud(o, u, t);
              As(o, h);
              break e;
            case 1:
              i = u;
              var p = o.type,
                v = o.stateNode;
              if (
                !(o.flags & 128) &&
                (typeof p.getDerivedStateFromError == 'function' ||
                  (v !== null &&
                    typeof v.componentDidCatch == 'function' &&
                    (Rt === null || !Rt.has(v))))
              ) {
                ((o.flags |= 65536), (t &= -t), (o.lanes |= t));
                var k = cd(o, i, t);
                As(o, k);
                break e;
              }
          }
          o = o.return;
        } while (o !== null);
      }
      Td(n);
    } catch (j) {
      ((t = j), Z === n && n !== null && (Z = n = n.return));
      continue;
    }
    break;
  } while (!0);
}
function _d() {
  var e = Kl.current;
  return ((Kl.current = Ql), e === null ? Ql : e);
}
function Fi() {
  ((ne === 0 || ne === 3 || ne === 2) && (ne = 4),
    oe === null || (!(rn & 268435455) && !(io & 268435455)) || Et(oe, ie));
}
function Gl(e, t) {
  var n = z;
  z |= 2;
  var r = _d();
  (oe !== e || ie !== t) && ((ot = null), Xt(e, t));
  do
    try {
      Qm();
      break;
    } catch (l) {
      Cd(e, l);
    }
  while (!0);
  if ((xi(), (z = n), (Kl.current = r), Z !== null)) throw Error(w(261));
  return ((oe = null), (ie = 0), ne);
}
function Qm() {
  for (; Z !== null;) Pd(Z);
}
function Km() {
  for (; Z !== null && !gp();) Pd(Z);
}
function Pd(e) {
  var t = Ld(e.alternate, e, Ce);
  ((e.memoizedProps = e.pendingProps), t === null ? Td(e) : (Z = t), (Ri.current = null));
}
function Td(e) {
  var t = e;
  do {
    var n = t.alternate;
    if (((e = t.return), t.flags & 32768)) {
      if (((n = Am(n, t)), n !== null)) {
        ((n.flags &= 32767), (Z = n));
        return;
      }
      if (e !== null) ((e.flags |= 32768), (e.subtreeFlags = 0), (e.deletions = null));
      else {
        ((ne = 6), (Z = null));
        return;
      }
    } else if (((n = $m(n, t, Ce)), n !== null)) {
      Z = n;
      return;
    }
    if (((t = t.sibling), t !== null)) {
      Z = t;
      return;
    }
    Z = t = e;
  } while (t !== null);
  ne === 0 && (ne = 5);
}
function Ht(e, t, n) {
  var r = M,
    l = Fe.transition;
  try {
    ((Fe.transition = null), (M = 1), bm(e, t, n, r));
  } finally {
    ((Fe.transition = l), (M = r));
  }
  return null;
}
function bm(e, t, n, r) {
  do Ln();
  while (Nt !== null);
  if (z & 6) throw Error(w(327));
  n = e.finishedWork;
  var l = e.finishedLanes;
  if (n === null) return null;
  if (((e.finishedWork = null), (e.finishedLanes = 0), n === e.current)) throw Error(w(177));
  ((e.callbackNode = null), (e.callbackPriority = 0));
  var o = n.lanes | n.childLanes;
  if (
    (_p(e, o),
    e === oe && ((Z = oe = null), (ie = 0)),
    (!(n.subtreeFlags & 2064) && !(n.flags & 2064)) ||
      ul ||
      ((ul = !0),
      Rd(Ol, function () {
        return (Ln(), null);
      })),
    (o = (n.flags & 15990) !== 0),
    n.subtreeFlags & 15990 || o)
  ) {
    ((o = Fe.transition), (Fe.transition = null));
    var a = M;
    M = 1;
    var i = z;
    ((z |= 4),
      (Ri.current = null),
      Bm(e, n),
      Ed(n, e),
      pm(va),
      (Rl = !!ha),
      (va = ha = null),
      (e.current = n),
      Vm(n),
      yp(),
      (z = i),
      (M = a),
      (Fe.transition = o));
  } else e.current = n;
  if (
    (ul && ((ul = !1), (Nt = e), (Yl = l)),
    (o = e.pendingLanes),
    o === 0 && (Rt = null),
    Sp(n.stateNode),
    Ee(e, X()),
    t !== null)
  )
    for (r = e.onRecoverableError, n = 0; n < t.length; n++)
      ((l = t[n]), r(l.value, { componentStack: l.stack, digest: l.digest }));
  if (bl) throw ((bl = !1), (e = Ma), (Ma = null), e);
  return (
    Yl & 1 && e.tag !== 0 && Ln(),
    (o = e.pendingLanes),
    o & 1 ? (e === Fa ? vr++ : ((vr = 0), (Fa = e))) : (vr = 0),
    Ut(),
    null
  );
}
function Ln() {
  if (Nt !== null) {
    var e = uc(Yl),
      t = Fe.transition,
      n = M;
    try {
      if (((Fe.transition = null), (M = 16 > e ? 16 : e), Nt === null)) var r = !1;
      else {
        if (((e = Nt), (Nt = null), (Yl = 0), z & 6)) throw Error(w(331));
        var l = z;
        for (z |= 4, C = e.current; C !== null;) {
          var o = C,
            a = o.child;
          if (C.flags & 16) {
            var i = o.deletions;
            if (i !== null) {
              for (var u = 0; u < i.length; u++) {
                var c = i[u];
                for (C = c; C !== null;) {
                  var m = C;
                  switch (m.tag) {
                    case 0:
                    case 11:
                    case 15:
                      mr(8, m, o);
                  }
                  var d = m.child;
                  if (d !== null) ((d.return = m), (C = d));
                  else
                    for (; C !== null;) {
                      m = C;
                      var f = m.sibling,
                        y = m.return;
                      if ((kd(m), m === c)) {
                        C = null;
                        break;
                      }
                      if (f !== null) {
                        ((f.return = y), (C = f));
                        break;
                      }
                      C = y;
                    }
                }
              }
              var S = o.alternate;
              if (S !== null) {
                var x = S.child;
                if (x !== null) {
                  S.child = null;
                  do {
                    var E = x.sibling;
                    ((x.sibling = null), (x = E));
                  } while (x !== null);
                }
              }
              C = o;
            }
          }
          if (o.subtreeFlags & 2064 && a !== null) ((a.return = o), (C = a));
          else
            e: for (; C !== null;) {
              if (((o = C), o.flags & 2048))
                switch (o.tag) {
                  case 0:
                  case 11:
                  case 15:
                    mr(9, o, o.return);
                }
              var h = o.sibling;
              if (h !== null) {
                ((h.return = o.return), (C = h));
                break e;
              }
              C = o.return;
            }
        }
        var p = e.current;
        for (C = p; C !== null;) {
          a = C;
          var v = a.child;
          if (a.subtreeFlags & 2064 && v !== null) ((v.return = a), (C = v));
          else
            e: for (a = p; C !== null;) {
              if (((i = C), i.flags & 2048))
                try {
                  switch (i.tag) {
                    case 0:
                    case 11:
                    case 15:
                      ao(9, i);
                  }
                } catch (j) {
                  Y(i, i.return, j);
                }
              if (i === a) {
                C = null;
                break e;
              }
              var k = i.sibling;
              if (k !== null) {
                ((k.return = i.return), (C = k));
                break e;
              }
              C = i.return;
            }
        }
        if (((z = l), Ut(), et && typeof et.onPostCommitFiberRoot == 'function'))
          try {
            et.onPostCommitFiberRoot(Zl, e);
          } catch {}
        r = !0;
      }
      return r;
    } finally {
      ((M = n), (Fe.transition = t));
    }
  }
  return !1;
}
function au(e, t, n) {
  ((t = Fn(n, t)),
    (t = ud(e, t, 1)),
    (e = Lt(e, t, 1)),
    (t = he()),
    e !== null && (Ur(e, 1, t), Ee(e, t)));
}
function Y(e, t, n) {
  if (e.tag === 3) au(e, e, n);
  else
    for (; t !== null;) {
      if (t.tag === 3) {
        au(t, e, n);
        break;
      } else if (t.tag === 1) {
        var r = t.stateNode;
        if (
          typeof t.type.getDerivedStateFromError == 'function' ||
          (typeof r.componentDidCatch == 'function' && (Rt === null || !Rt.has(r)))
        ) {
          ((e = Fn(n, e)),
            (e = cd(t, e, 1)),
            (t = Lt(t, e, 1)),
            (e = he()),
            t !== null && (Ur(t, 1, e), Ee(t, e)));
          break;
        }
      }
      t = t.return;
    }
}
function Ym(e, t, n) {
  var r = e.pingCache;
  (r !== null && r.delete(t),
    (t = he()),
    (e.pingedLanes |= e.suspendedLanes & n),
    oe === e &&
      (ie & n) === n &&
      (ne === 4 || (ne === 3 && (ie & 130023424) === ie && 500 > X() - zi) ? Xt(e, 0) : (Di |= n)),
    Ee(e, t));
}
function Od(e, t) {
  t === 0 && (e.mode & 1 ? ((t = qr), (qr <<= 1), !(qr & 130023424) && (qr = 4194304)) : (t = 1));
  var n = he();
  ((e = ft(e, t)), e !== null && (Ur(e, t, n), Ee(e, n)));
}
function Gm(e) {
  var t = e.memoizedState,
    n = 0;
  (t !== null && (n = t.retryLane), Od(e, n));
}
function Xm(e, t) {
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
      throw Error(w(314));
  }
  (r !== null && r.delete(t), Od(e, n));
}
var Ld;
Ld = function (e, t, n) {
  if (e !== null)
    if (e.memoizedProps !== t.pendingProps || Se.current) ke = !0;
    else {
      if (!(e.lanes & n) && !(t.flags & 128)) return ((ke = !1), Fm(e, t, n));
      ke = !!(e.flags & 131072);
    }
  else ((ke = !1), H && t.flags & 1048576 && Ic(t, Al, t.index));
  switch (((t.lanes = 0), t.tag)) {
    case 2:
      var r = t.type;
      (wl(e, t), (e = t.pendingProps));
      var l = Dn(t, pe.current);
      (On(t, n), (l = _i(null, t, r, e, l, n)));
      var o = Pi();
      return (
        (t.flags |= 1),
        typeof l == 'object' && l !== null && typeof l.render == 'function' && l.$$typeof === void 0
          ? ((t.tag = 1),
            (t.memoizedState = null),
            (t.updateQueue = null),
            we(r) ? ((o = !0), Fl(t)) : (o = !1),
            (t.memoizedState = l.state !== null && l.state !== void 0 ? l.state : null),
            wi(t),
            (l.updater = oo),
            (t.stateNode = l),
            (l._reactInternals = t),
            Na(t, r, e, n),
            (t = Pa(null, t, r, !0, o, n)))
          : ((t.tag = 0), H && o && hi(t), me(null, t, l, n), (t = t.child)),
        t
      );
    case 16:
      r = t.elementType;
      e: {
        switch (
          (wl(e, t),
          (e = t.pendingProps),
          (l = r._init),
          (r = l(r._payload)),
          (t.type = r),
          (l = t.tag = Zm(r)),
          (e = Ve(r, e)),
          l)
        ) {
          case 0:
            t = _a(null, t, r, e, n);
            break e;
          case 1:
            t = Xs(null, t, r, e, n);
            break e;
          case 11:
            t = Ys(null, t, r, e, n);
            break e;
          case 14:
            t = Gs(null, t, r, Ve(r.type, e), n);
            break e;
        }
        throw Error(w(306, r, ''));
      }
      return t;
    case 0:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : Ve(r, l)),
        _a(e, t, r, l, n)
      );
    case 1:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : Ve(r, l)),
        Xs(e, t, r, l, n)
      );
    case 3:
      e: {
        if ((md(t), e === null)) throw Error(w(387));
        ((r = t.pendingProps), (o = t.memoizedState), (l = o.element), Bc(e, t), Vl(t, r, null, n));
        var a = t.memoizedState;
        if (((r = a.element), o.isDehydrated))
          if (
            ((o = {
              element: r,
              isDehydrated: !1,
              cache: a.cache,
              pendingSuspenseBoundaries: a.pendingSuspenseBoundaries,
              transitions: a.transitions,
            }),
            (t.updateQueue.baseState = o),
            (t.memoizedState = o),
            t.flags & 256)
          ) {
            ((l = Fn(Error(w(423)), t)), (t = Js(e, t, r, n, l)));
            break e;
          } else if (r !== l) {
            ((l = Fn(Error(w(424)), t)), (t = Js(e, t, r, n, l)));
            break e;
          } else
            for (
              _e = Ot(t.stateNode.containerInfo.firstChild),
                Pe = t,
                H = !0,
                He = null,
                n = Ac(t, null, r, n),
                t.child = n;
              n;
            )
              ((n.flags = (n.flags & -3) | 4096), (n = n.sibling));
        else {
          if ((zn(), r === l)) {
            t = pt(e, t, n);
            break e;
          }
          me(e, t, r, n);
        }
        t = t.child;
      }
      return t;
    case 5:
      return (
        Vc(t),
        e === null && wa(t),
        (r = t.type),
        (l = t.pendingProps),
        (o = e !== null ? e.memoizedProps : null),
        (a = l.children),
        ga(r, l) ? (a = null) : o !== null && ga(r, o) && (t.flags |= 32),
        pd(e, t),
        me(e, t, a, n),
        t.child
      );
    case 6:
      return (e === null && wa(t), null);
    case 13:
      return hd(e, t, n);
    case 4:
      return (
        Ei(t, t.stateNode.containerInfo),
        (r = t.pendingProps),
        e === null ? (t.child = In(t, null, r, n)) : me(e, t, r, n),
        t.child
      );
    case 11:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : Ve(r, l)),
        Ys(e, t, r, l, n)
      );
    case 7:
      return (me(e, t, t.pendingProps, n), t.child);
    case 8:
      return (me(e, t, t.pendingProps.children, n), t.child);
    case 12:
      return (me(e, t, t.pendingProps.children, n), t.child);
    case 10:
      e: {
        if (
          ((r = t.type._context),
          (l = t.pendingProps),
          (o = t.memoizedProps),
          (a = l.value),
          U(Ul, r._currentValue),
          (r._currentValue = a),
          o !== null)
        )
          if (be(o.value, a)) {
            if (o.children === l.children && !Se.current) {
              t = pt(e, t, n);
              break e;
            }
          } else
            for (o = t.child, o !== null && (o.return = t); o !== null;) {
              var i = o.dependencies;
              if (i !== null) {
                a = o.child;
                for (var u = i.firstContext; u !== null;) {
                  if (u.context === r) {
                    if (o.tag === 1) {
                      ((u = ut(-1, n & -n)), (u.tag = 2));
                      var c = o.updateQueue;
                      if (c !== null) {
                        c = c.shared;
                        var m = c.pending;
                        (m === null ? (u.next = u) : ((u.next = m.next), (m.next = u)),
                          (c.pending = u));
                      }
                    }
                    ((o.lanes |= n),
                      (u = o.alternate),
                      u !== null && (u.lanes |= n),
                      Ea(o.return, n, t),
                      (i.lanes |= n));
                    break;
                  }
                  u = u.next;
                }
              } else if (o.tag === 10) a = o.type === t.type ? null : o.child;
              else if (o.tag === 18) {
                if (((a = o.return), a === null)) throw Error(w(341));
                ((a.lanes |= n),
                  (i = a.alternate),
                  i !== null && (i.lanes |= n),
                  Ea(a, n, t),
                  (a = o.sibling));
              } else a = o.child;
              if (a !== null) a.return = o;
              else
                for (a = o; a !== null;) {
                  if (a === t) {
                    a = null;
                    break;
                  }
                  if (((o = a.sibling), o !== null)) {
                    ((o.return = a.return), (a = o));
                    break;
                  }
                  a = a.return;
                }
              o = a;
            }
        (me(e, t, l.children, n), (t = t.child));
      }
      return t;
    case 9:
      return (
        (l = t.type),
        (r = t.pendingProps.children),
        On(t, n),
        (l = $e(l)),
        (r = r(l)),
        (t.flags |= 1),
        me(e, t, r, n),
        t.child
      );
    case 14:
      return ((r = t.type), (l = Ve(r, t.pendingProps)), (l = Ve(r.type, l)), Gs(e, t, r, l, n));
    case 15:
      return dd(e, t, t.type, t.pendingProps, n);
    case 17:
      return (
        (r = t.type),
        (l = t.pendingProps),
        (l = t.elementType === r ? l : Ve(r, l)),
        wl(e, t),
        (t.tag = 1),
        we(r) ? ((e = !0), Fl(t)) : (e = !1),
        On(t, n),
        sd(t, r, l),
        Na(t, r, l, n),
        Pa(null, t, r, !0, e, n)
      );
    case 19:
      return vd(e, t, n);
    case 22:
      return fd(e, t, n);
  }
  throw Error(w(156, t.tag));
};
function Rd(e, t) {
  return oc(e, t);
}
function Jm(e, t, n, r) {
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
function Me(e, t, n, r) {
  return new Jm(e, t, n, r);
}
function $i(e) {
  return ((e = e.prototype), !(!e || !e.isReactComponent));
}
function Zm(e) {
  if (typeof e == 'function') return $i(e) ? 1 : 0;
  if (e != null) {
    if (((e = e.$$typeof), e === ri)) return 11;
    if (e === li) return 14;
  }
  return 2;
}
function zt(e, t) {
  var n = e.alternate;
  return (
    n === null
      ? ((n = Me(e.tag, t, e.key, e.mode)),
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
function Nl(e, t, n, r, l, o) {
  var a = 2;
  if (((r = e), typeof e == 'function')) $i(e) && (a = 1);
  else if (typeof e == 'string') a = 5;
  else
    e: switch (e) {
      case hn:
        return Jt(n.children, l, o, t);
      case ni:
        ((a = 8), (l |= 8));
        break;
      case Go:
        return ((e = Me(12, n, t, l | 2)), (e.elementType = Go), (e.lanes = o), e);
      case Xo:
        return ((e = Me(13, n, t, l)), (e.elementType = Xo), (e.lanes = o), e);
      case Jo:
        return ((e = Me(19, n, t, l)), (e.elementType = Jo), (e.lanes = o), e);
      case Vu:
        return so(n, l, o, t);
      default:
        if (typeof e == 'object' && e !== null)
          switch (e.$$typeof) {
            case Uu:
              a = 10;
              break e;
            case Bu:
              a = 9;
              break e;
            case ri:
              a = 11;
              break e;
            case li:
              a = 14;
              break e;
            case kt:
              ((a = 16), (r = null));
              break e;
          }
        throw Error(w(130, e == null ? e : typeof e, ''));
    }
  return ((t = Me(a, n, t, l)), (t.elementType = e), (t.type = r), (t.lanes = o), t);
}
function Jt(e, t, n, r) {
  return ((e = Me(7, e, r, t)), (e.lanes = n), e);
}
function so(e, t, n, r) {
  return (
    (e = Me(22, e, r, t)),
    (e.elementType = Vu),
    (e.lanes = n),
    (e.stateNode = { isHidden: !1 }),
    e
  );
}
function Ho(e, t, n) {
  return ((e = Me(6, e, null, t)), (e.lanes = n), e);
}
function Qo(e, t, n) {
  return (
    (t = Me(4, e.children !== null ? e.children : [], e.key, t)),
    (t.lanes = n),
    (t.stateNode = {
      containerInfo: e.containerInfo,
      pendingChildren: null,
      implementation: e.implementation,
    }),
    t
  );
}
function qm(e, t, n, r, l) {
  ((this.tag = t),
    (this.containerInfo = e),
    (this.finishedWork = this.pingCache = this.current = this.pendingChildren = null),
    (this.timeoutHandle = -1),
    (this.callbackNode = this.pendingContext = this.context = null),
    (this.callbackPriority = 0),
    (this.eventTimes = No(0)),
    (this.expirationTimes = No(-1)),
    (this.entangledLanes =
      this.finishedLanes =
      this.mutableReadLanes =
      this.expiredLanes =
      this.pingedLanes =
      this.suspendedLanes =
      this.pendingLanes =
        0),
    (this.entanglements = No(0)),
    (this.identifierPrefix = r),
    (this.onRecoverableError = l),
    (this.mutableSourceEagerHydrationData = null));
}
function Ai(e, t, n, r, l, o, a, i, u) {
  return (
    (e = new qm(e, t, n, i, u)),
    t === 1 ? ((t = 1), o === !0 && (t |= 8)) : (t = 0),
    (o = Me(3, null, null, t)),
    (e.current = o),
    (o.stateNode = e),
    (o.memoizedState = {
      element: r,
      isDehydrated: n,
      cache: null,
      transitions: null,
      pendingSuspenseBoundaries: null,
    }),
    wi(o),
    e
  );
}
function eh(e, t, n) {
  var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
  return {
    $$typeof: mn,
    key: r == null ? null : '' + r,
    children: e,
    containerInfo: t,
    implementation: n,
  };
}
function Dd(e) {
  if (!e) return Mt;
  e = e._reactInternals;
  e: {
    if (an(e) !== e || e.tag !== 1) throw Error(w(170));
    var t = e;
    do {
      switch (t.tag) {
        case 3:
          t = t.stateNode.context;
          break e;
        case 1:
          if (we(t.type)) {
            t = t.stateNode.__reactInternalMemoizedMergedChildContext;
            break e;
          }
      }
      t = t.return;
    } while (t !== null);
    throw Error(w(171));
  }
  if (e.tag === 1) {
    var n = e.type;
    if (we(n)) return Dc(e, n, t);
  }
  return t;
}
function zd(e, t, n, r, l, o, a, i, u) {
  return (
    (e = Ai(n, r, !0, e, l, o, a, i, u)),
    (e.context = Dd(null)),
    (n = e.current),
    (r = he()),
    (l = Dt(n)),
    (o = ut(r, l)),
    (o.callback = t ?? null),
    Lt(n, o, l),
    (e.current.lanes = l),
    Ur(e, l, r),
    Ee(e, r),
    e
  );
}
function uo(e, t, n, r) {
  var l = t.current,
    o = he(),
    a = Dt(l);
  return (
    (n = Dd(n)),
    t.context === null ? (t.context = n) : (t.pendingContext = n),
    (t = ut(o, a)),
    (t.payload = { element: e }),
    (r = r === void 0 ? null : r),
    r !== null && (t.callback = r),
    (e = Lt(l, t, a)),
    e !== null && (Ke(e, l, a, o), xl(e, l, a)),
    a
  );
}
function Xl(e) {
  if (((e = e.current), !e.child)) return null;
  switch (e.child.tag) {
    case 5:
      return e.child.stateNode;
    default:
      return e.child.stateNode;
  }
}
function iu(e, t) {
  if (((e = e.memoizedState), e !== null && e.dehydrated !== null)) {
    var n = e.retryLane;
    e.retryLane = n !== 0 && n < t ? n : t;
  }
}
function Ui(e, t) {
  (iu(e, t), (e = e.alternate) && iu(e, t));
}
function th() {
  return null;
}
var Id =
  typeof reportError == 'function'
    ? reportError
    : function (e) {
        console.error(e);
      };
function Bi(e) {
  this._internalRoot = e;
}
co.prototype.render = Bi.prototype.render = function (e) {
  var t = this._internalRoot;
  if (t === null) throw Error(w(409));
  uo(e, t, null, null);
};
co.prototype.unmount = Bi.prototype.unmount = function () {
  var e = this._internalRoot;
  if (e !== null) {
    this._internalRoot = null;
    var t = e.containerInfo;
    (ln(function () {
      uo(null, e, null, null);
    }),
      (t[dt] = null));
  }
};
function co(e) {
  this._internalRoot = e;
}
co.prototype.unstable_scheduleHydration = function (e) {
  if (e) {
    var t = fc();
    e = { blockedOn: null, target: e, priority: t };
    for (var n = 0; n < wt.length && t !== 0 && t < wt[n].priority; n++);
    (wt.splice(n, 0, e), n === 0 && mc(e));
  }
};
function Vi(e) {
  return !(!e || (e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11));
}
function fo(e) {
  return !(
    !e ||
    (e.nodeType !== 1 &&
      e.nodeType !== 9 &&
      e.nodeType !== 11 &&
      (e.nodeType !== 8 || e.nodeValue !== ' react-mount-point-unstable '))
  );
}
function su() {}
function nh(e, t, n, r, l) {
  if (l) {
    if (typeof r == 'function') {
      var o = r;
      r = function () {
        var c = Xl(a);
        o.call(c);
      };
    }
    var a = zd(t, r, e, 0, null, !1, !1, '', su);
    return (
      (e._reactRootContainer = a),
      (e[dt] = a.current),
      Nr(e.nodeType === 8 ? e.parentNode : e),
      ln(),
      a
    );
  }
  for (; (l = e.lastChild);) e.removeChild(l);
  if (typeof r == 'function') {
    var i = r;
    r = function () {
      var c = Xl(u);
      i.call(c);
    };
  }
  var u = Ai(e, 0, !1, null, null, !1, !1, '', su);
  return (
    (e._reactRootContainer = u),
    (e[dt] = u.current),
    Nr(e.nodeType === 8 ? e.parentNode : e),
    ln(function () {
      uo(t, u, n, r);
    }),
    u
  );
}
function po(e, t, n, r, l) {
  var o = n._reactRootContainer;
  if (o) {
    var a = o;
    if (typeof l == 'function') {
      var i = l;
      l = function () {
        var u = Xl(a);
        i.call(u);
      };
    }
    uo(t, a, e, l);
  } else a = nh(n, t, e, l, r);
  return Xl(a);
}
cc = function (e) {
  switch (e.tag) {
    case 3:
      var t = e.stateNode;
      if (t.current.memoizedState.isDehydrated) {
        var n = ar(t.pendingLanes);
        n !== 0 && (ii(t, n | 1), Ee(t, X()), !(z & 6) && (($n = X() + 500), Ut()));
      }
      break;
    case 13:
      (ln(function () {
        var r = ft(e, 1);
        if (r !== null) {
          var l = he();
          Ke(r, e, 1, l);
        }
      }),
        Ui(e, 1));
  }
};
si = function (e) {
  if (e.tag === 13) {
    var t = ft(e, 134217728);
    if (t !== null) {
      var n = he();
      Ke(t, e, 134217728, n);
    }
    Ui(e, 134217728);
  }
};
dc = function (e) {
  if (e.tag === 13) {
    var t = Dt(e),
      n = ft(e, t);
    if (n !== null) {
      var r = he();
      Ke(n, e, t, r);
    }
    Ui(e, t);
  }
};
fc = function () {
  return M;
};
pc = function (e, t) {
  var n = M;
  try {
    return ((M = e), t());
  } finally {
    M = n;
  }
};
ia = function (e, t, n) {
  switch (t) {
    case 'input':
      if ((ea(e, n), (t = n.name), n.type === 'radio' && t != null)) {
        for (n = e; n.parentNode;) n = n.parentNode;
        for (
          n = n.querySelectorAll('input[name=' + JSON.stringify('' + t) + '][type="radio"]'), t = 0;
          t < n.length;
          t++
        ) {
          var r = n[t];
          if (r !== e && r.form === e.form) {
            var l = no(r);
            if (!l) throw Error(w(90));
            (Hu(r), ea(r, l));
          }
        }
      }
      break;
    case 'textarea':
      Ku(e, n);
      break;
    case 'select':
      ((t = n.value), t != null && Cn(e, !!n.multiple, t, !1));
  }
};
qu = Ii;
ec = ln;
var rh = { usingClientEntryPoint: !1, Events: [Vr, xn, no, Ju, Zu, Ii] },
  nr = {
    findFiberByHostInstance: Kt,
    bundleType: 0,
    version: '18.3.1',
    rendererPackageName: 'react-dom',
  },
  lh = {
    bundleType: nr.bundleType,
    version: nr.version,
    rendererPackageName: nr.rendererPackageName,
    rendererConfig: nr.rendererConfig,
    overrideHookState: null,
    overrideHookStateDeletePath: null,
    overrideHookStateRenamePath: null,
    overrideProps: null,
    overridePropsDeletePath: null,
    overridePropsRenamePath: null,
    setErrorHandler: null,
    setSuspenseHandler: null,
    scheduleUpdate: null,
    currentDispatcherRef: ht.ReactCurrentDispatcher,
    findHostInstanceByFiber: function (e) {
      return ((e = rc(e)), e === null ? null : e.stateNode);
    },
    findFiberByHostInstance: nr.findFiberByHostInstance || th,
    findHostInstancesForRefresh: null,
    scheduleRefresh: null,
    scheduleRoot: null,
    setRefreshHandler: null,
    getCurrentFiber: null,
    reconcilerVersion: '18.3.1-next-f1338f8080-20240426',
  };
if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < 'u') {
  var cl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!cl.isDisabled && cl.supportsFiber)
    try {
      ((Zl = cl.inject(lh)), (et = cl));
    } catch {}
}
Oe.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = rh;
Oe.createPortal = function (e, t) {
  var n = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
  if (!Vi(t)) throw Error(w(200));
  return eh(e, t, null, n);
};
Oe.createRoot = function (e, t) {
  if (!Vi(e)) throw Error(w(299));
  var n = !1,
    r = '',
    l = Id;
  return (
    t != null &&
      (t.unstable_strictMode === !0 && (n = !0),
      t.identifierPrefix !== void 0 && (r = t.identifierPrefix),
      t.onRecoverableError !== void 0 && (l = t.onRecoverableError)),
    (t = Ai(e, 1, !1, null, null, n, !1, r, l)),
    (e[dt] = t.current),
    Nr(e.nodeType === 8 ? e.parentNode : e),
    new Bi(t)
  );
};
Oe.findDOMNode = function (e) {
  if (e == null) return null;
  if (e.nodeType === 1) return e;
  var t = e._reactInternals;
  if (t === void 0)
    throw typeof e.render == 'function'
      ? Error(w(188))
      : ((e = Object.keys(e).join(',')), Error(w(268, e)));
  return ((e = rc(t)), (e = e === null ? null : e.stateNode), e);
};
Oe.flushSync = function (e) {
  return ln(e);
};
Oe.hydrate = function (e, t, n) {
  if (!fo(t)) throw Error(w(200));
  return po(null, e, t, !0, n);
};
Oe.hydrateRoot = function (e, t, n) {
  if (!Vi(e)) throw Error(w(405));
  var r = (n != null && n.hydratedSources) || null,
    l = !1,
    o = '',
    a = Id;
  if (
    (n != null &&
      (n.unstable_strictMode === !0 && (l = !0),
      n.identifierPrefix !== void 0 && (o = n.identifierPrefix),
      n.onRecoverableError !== void 0 && (a = n.onRecoverableError)),
    (t = zd(t, null, e, 1, n ?? null, l, !1, o, a)),
    (e[dt] = t.current),
    Nr(e),
    r)
  )
    for (e = 0; e < r.length; e++)
      ((n = r[e]),
        (l = n._getVersion),
        (l = l(n._source)),
        t.mutableSourceEagerHydrationData == null
          ? (t.mutableSourceEagerHydrationData = [n, l])
          : t.mutableSourceEagerHydrationData.push(n, l));
  return new co(t);
};
Oe.render = function (e, t, n) {
  if (!fo(t)) throw Error(w(200));
  return po(null, e, t, !1, n);
};
Oe.unmountComponentAtNode = function (e) {
  if (!fo(e)) throw Error(w(40));
  return e._reactRootContainer
    ? (ln(function () {
        po(null, null, e, !1, function () {
          ((e._reactRootContainer = null), (e[dt] = null));
        });
      }),
      !0)
    : !1;
};
Oe.unstable_batchedUpdates = Ii;
Oe.unstable_renderSubtreeIntoContainer = function (e, t, n, r) {
  if (!fo(n)) throw Error(w(200));
  if (e == null || e._reactInternals === void 0) throw Error(w(38));
  return po(e, t, n, !1, r);
};
Oe.version = '18.3.1-next-f1338f8080-20240426';
function Md() {
  if (!(
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > 'u' ||
    typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != 'function'
  ))
    try {
      __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(Md);
    } catch (e) {
      console.error(e);
    }
}
(Md(), (Mu.exports = Oe));
var oh = Mu.exports,
  Fd,
  uu = oh;
((Fd = uu.createRoot), uu.hydrateRoot);
/**
 * @remix-run/router v1.23.0
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */ function zr() {
  return (
    (zr = Object.assign
      ? Object.assign.bind()
      : function (e) {
          for (var t = 1; t < arguments.length; t++) {
            var n = arguments[t];
            for (var r in n) Object.prototype.hasOwnProperty.call(n, r) && (e[r] = n[r]);
          }
          return e;
        }),
    zr.apply(this, arguments)
  );
}
var Ct;
(function (e) {
  ((e.Pop = 'POP'), (e.Push = 'PUSH'), (e.Replace = 'REPLACE'));
})(Ct || (Ct = {}));
const cu = 'popstate';
function ah(e) {
  e === void 0 && (e = {});
  function t(r, l) {
    let { pathname: o, search: a, hash: i } = r.location;
    return Ua(
      '',
      { pathname: o, search: a, hash: i },
      (l.state && l.state.usr) || null,
      (l.state && l.state.key) || 'default',
    );
  }
  function n(r, l) {
    return typeof l == 'string' ? l : Ad(l);
  }
  return sh(t, n, null, e);
}
function q(e, t) {
  if (e === !1 || e === null || typeof e > 'u') throw new Error(t);
}
function $d(e, t) {
  if (!e) {
    typeof console < 'u' && console.warn(t);
    try {
      throw new Error(t);
    } catch {}
  }
}
function ih() {
  return Math.random().toString(36).substr(2, 8);
}
function du(e, t) {
  return { usr: e.state, key: e.key, idx: t };
}
function Ua(e, t, n, r) {
  return (
    n === void 0 && (n = null),
    zr(
      { pathname: typeof e == 'string' ? e : e.pathname, search: '', hash: '' },
      typeof t == 'string' ? Wn(t) : t,
      { state: n, key: (t && t.key) || r || ih() },
    )
  );
}
function Ad(e) {
  let { pathname: t = '/', search: n = '', hash: r = '' } = e;
  return (
    n && n !== '?' && (t += n.charAt(0) === '?' ? n : '?' + n),
    r && r !== '#' && (t += r.charAt(0) === '#' ? r : '#' + r),
    t
  );
}
function Wn(e) {
  let t = {};
  if (e) {
    let n = e.indexOf('#');
    n >= 0 && ((t.hash = e.substr(n)), (e = e.substr(0, n)));
    let r = e.indexOf('?');
    (r >= 0 && ((t.search = e.substr(r)), (e = e.substr(0, r))), e && (t.pathname = e));
  }
  return t;
}
function sh(e, t, n, r) {
  r === void 0 && (r = {});
  let { window: l = document.defaultView, v5Compat: o = !1 } = r,
    a = l.history,
    i = Ct.Pop,
    u = null,
    c = m();
  c == null && ((c = 0), a.replaceState(zr({}, a.state, { idx: c }), ''));
  function m() {
    return (a.state || { idx: null }).idx;
  }
  function d() {
    i = Ct.Pop;
    let E = m(),
      h = E == null ? null : E - c;
    ((c = E), u && u({ action: i, location: x.location, delta: h }));
  }
  function f(E, h) {
    i = Ct.Push;
    let p = Ua(x.location, E, h);
    c = m() + 1;
    let v = du(p, c),
      k = x.createHref(p);
    try {
      a.pushState(v, '', k);
    } catch (j) {
      if (j instanceof DOMException && j.name === 'DataCloneError') throw j;
      l.location.assign(k);
    }
    o && u && u({ action: i, location: x.location, delta: 1 });
  }
  function y(E, h) {
    i = Ct.Replace;
    let p = Ua(x.location, E, h);
    c = m();
    let v = du(p, c),
      k = x.createHref(p);
    (a.replaceState(v, '', k), o && u && u({ action: i, location: x.location, delta: 0 }));
  }
  function S(E) {
    let h = l.location.origin !== 'null' ? l.location.origin : l.location.href,
      p = typeof E == 'string' ? E : Ad(E);
    return (
      (p = p.replace(/ $/, '%20')),
      q(h, 'No window.location.(origin|href) available to create URL for href: ' + p),
      new URL(p, h)
    );
  }
  let x = {
    get action() {
      return i;
    },
    get location() {
      return e(l, a);
    },
    listen(E) {
      if (u) throw new Error('A history only accepts one active listener');
      return (
        l.addEventListener(cu, d),
        (u = E),
        () => {
          (l.removeEventListener(cu, d), (u = null));
        }
      );
    },
    createHref(E) {
      return t(l, E);
    },
    createURL: S,
    encodeLocation(E) {
      let h = S(E);
      return { pathname: h.pathname, search: h.search, hash: h.hash };
    },
    push: f,
    replace: y,
    go(E) {
      return a.go(E);
    },
  };
  return x;
}
var fu;
(function (e) {
  ((e.data = 'data'), (e.deferred = 'deferred'), (e.redirect = 'redirect'), (e.error = 'error'));
})(fu || (fu = {}));
function uh(e, t, n) {
  return (n === void 0 && (n = '/'), ch(e, t, n));
}
function ch(e, t, n, r) {
  let l = typeof t == 'string' ? Wn(t) : t,
    o = Vd(l.pathname || '/', n);
  if (o == null) return null;
  let a = Ud(e);
  dh(a);
  let i = null;
  for (let u = 0; i == null && u < a.length; ++u) {
    let c = Eh(o);
    i = kh(a[u], c);
  }
  return i;
}
function Ud(e, t, n, r) {
  (t === void 0 && (t = []), n === void 0 && (n = []), r === void 0 && (r = ''));
  let l = (o, a, i) => {
    let u = {
      relativePath: i === void 0 ? o.path || '' : i,
      caseSensitive: o.caseSensitive === !0,
      childrenIndex: a,
      route: o,
    };
    u.relativePath.startsWith('/') &&
      (q(
        u.relativePath.startsWith(r),
        'Absolute route path "' +
          u.relativePath +
          '" nested under path ' +
          ('"' + r + '" is not valid. An absolute child route path ') +
          'must start with the combined path of all its parent routes.',
      ),
      (u.relativePath = u.relativePath.slice(r.length)));
    let c = Zt([r, u.relativePath]),
      m = n.concat(u);
    (o.children &&
      o.children.length > 0 &&
      (q(
        o.index !== !0,
        'Index routes must not have child routes. Please remove ' +
          ('all child routes from route path "' + c + '".'),
      ),
      Ud(o.children, t, m, c)),
      !(o.path == null && !o.index) && t.push({ path: c, score: yh(c, o.index), routesMeta: m }));
  };
  return (
    e.forEach((o, a) => {
      var i;
      if (o.path === '' || !((i = o.path) != null && i.includes('?'))) l(o, a);
      else for (let u of Bd(o.path)) l(o, a, u);
    }),
    t
  );
}
function Bd(e) {
  let t = e.split('/');
  if (t.length === 0) return [];
  let [n, ...r] = t,
    l = n.endsWith('?'),
    o = n.replace(/\?$/, '');
  if (r.length === 0) return l ? [o, ''] : [o];
  let a = Bd(r.join('/')),
    i = [];
  return (
    i.push(...a.map((u) => (u === '' ? o : [o, u].join('/')))),
    l && i.push(...a),
    i.map((u) => (e.startsWith('/') && u === '' ? '/' : u))
  );
}
function dh(e) {
  e.sort((t, n) =>
    t.score !== n.score
      ? n.score - t.score
      : xh(
          t.routesMeta.map((r) => r.childrenIndex),
          n.routesMeta.map((r) => r.childrenIndex),
        ),
  );
}
const fh = /^:[\w-]+$/,
  ph = 3,
  mh = 2,
  hh = 1,
  vh = 10,
  gh = -2,
  pu = (e) => e === '*';
function yh(e, t) {
  let n = e.split('/'),
    r = n.length;
  return (
    n.some(pu) && (r += gh),
    t && (r += mh),
    n.filter((l) => !pu(l)).reduce((l, o) => l + (fh.test(o) ? ph : o === '' ? hh : vh), r)
  );
}
function xh(e, t) {
  return e.length === t.length && e.slice(0, -1).every((r, l) => r === t[l])
    ? e[e.length - 1] - t[t.length - 1]
    : 0;
}
function kh(e, t, n) {
  let { routesMeta: r } = e,
    l = {},
    o = '/',
    a = [];
  for (let i = 0; i < r.length; ++i) {
    let u = r[i],
      c = i === r.length - 1,
      m = o === '/' ? t : t.slice(o.length) || '/',
      d = Sh({ path: u.relativePath, caseSensitive: u.caseSensitive, end: c }, m),
      f = u.route;
    if (!d) return null;
    (Object.assign(l, d.params),
      a.push({
        params: l,
        pathname: Zt([o, d.pathname]),
        pathnameBase: _h(Zt([o, d.pathnameBase])),
        route: f,
      }),
      d.pathnameBase !== '/' && (o = Zt([o, d.pathnameBase])));
  }
  return a;
}
function Sh(e, t) {
  typeof e == 'string' && (e = { path: e, caseSensitive: !1, end: !0 });
  let [n, r] = wh(e.path, e.caseSensitive, e.end),
    l = t.match(n);
  if (!l) return null;
  let o = l[0],
    a = o.replace(/(.)\/+$/, '$1'),
    i = l.slice(1);
  return {
    params: r.reduce((c, m, d) => {
      let { paramName: f, isOptional: y } = m;
      if (f === '*') {
        let x = i[d] || '';
        a = o.slice(0, o.length - x.length).replace(/(.)\/+$/, '$1');
      }
      const S = i[d];
      return (y && !S ? (c[f] = void 0) : (c[f] = (S || '').replace(/%2F/g, '/')), c);
    }, {}),
    pathname: o,
    pathnameBase: a,
    pattern: e,
  };
}
function wh(e, t, n) {
  (t === void 0 && (t = !1),
    n === void 0 && (n = !0),
    $d(
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
          (a, i, u) => (
            r.push({ paramName: i, isOptional: u != null }),
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
function Eh(e) {
  try {
    return e
      .split('/')
      .map((t) => decodeURIComponent(t).replace(/\//g, '%2F'))
      .join('/');
  } catch (t) {
    return (
      $d(
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
function Vd(e, t) {
  if (t === '/') return e;
  if (!e.toLowerCase().startsWith(t.toLowerCase())) return null;
  let n = t.endsWith('/') ? t.length - 1 : t.length,
    r = e.charAt(n);
  return r && r !== '/' ? null : e.slice(n) || '/';
}
function jh(e, t) {
  t === void 0 && (t = '/');
  let { pathname: n, search: r = '', hash: l = '' } = typeof e == 'string' ? Wn(e) : e;
  return { pathname: n ? (n.startsWith('/') ? n : Nh(n, t)) : t, search: Ph(r), hash: Th(l) };
}
function Nh(e, t) {
  let n = t.replace(/\/+$/, '').split('/');
  return (
    e.split('/').forEach((l) => {
      l === '..' ? n.length > 1 && n.pop() : l !== '.' && n.push(l);
    }),
    n.length > 1 ? n.join('/') : '/'
  );
}
function Ko(e, t, n, r) {
  return (
    "Cannot include a '" +
    e +
    "' character in a manually specified " +
    ('`to.' + t + '` field [' + JSON.stringify(r) + '].  Please separate it out to the ') +
    ('`to.' + n + '` field. Alternatively you may provide the full path as ') +
    'a string in <Link to="..."> and the router will parse it for you.'
  );
}
function Ch(e) {
  return e.filter((t, n) => n === 0 || (t.route.path && t.route.path.length > 0));
}
function Wd(e, t) {
  let n = Ch(e);
  return t
    ? n.map((r, l) => (l === n.length - 1 ? r.pathname : r.pathnameBase))
    : n.map((r) => r.pathnameBase);
}
function Hd(e, t, n, r) {
  r === void 0 && (r = !1);
  let l;
  typeof e == 'string'
    ? (l = Wn(e))
    : ((l = zr({}, e)),
      q(!l.pathname || !l.pathname.includes('?'), Ko('?', 'pathname', 'search', l)),
      q(!l.pathname || !l.pathname.includes('#'), Ko('#', 'pathname', 'hash', l)),
      q(!l.search || !l.search.includes('#'), Ko('#', 'search', 'hash', l)));
  let o = e === '' || l.pathname === '',
    a = o ? '/' : l.pathname,
    i;
  if (a == null) i = n;
  else {
    let d = t.length - 1;
    if (!r && a.startsWith('..')) {
      let f = a.split('/');
      for (; f[0] === '..';) (f.shift(), (d -= 1));
      l.pathname = f.join('/');
    }
    i = d >= 0 ? t[d] : '/';
  }
  let u = jh(l, i),
    c = a && a !== '/' && a.endsWith('/'),
    m = (o || a === '.') && n.endsWith('/');
  return (!u.pathname.endsWith('/') && (c || m) && (u.pathname += '/'), u);
}
const Zt = (e) => e.join('/').replace(/\/\/+/g, '/'),
  _h = (e) => e.replace(/\/+$/, '').replace(/^\/*/, '/'),
  Ph = (e) => (!e || e === '?' ? '' : e.startsWith('?') ? e : '?' + e),
  Th = (e) => (!e || e === '#' ? '' : e.startsWith('#') ? e : '#' + e);
function Oh(e) {
  return (
    e != null &&
    typeof e.status == 'number' &&
    typeof e.statusText == 'string' &&
    typeof e.internal == 'boolean' &&
    'data' in e
  );
}
const Qd = ['post', 'put', 'patch', 'delete'];
new Set(Qd);
const Lh = ['get', ...Qd];
new Set(Lh);
/**
 * React Router v6.30.0
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */ function Ir() {
  return (
    (Ir = Object.assign
      ? Object.assign.bind()
      : function (e) {
          for (var t = 1; t < arguments.length; t++) {
            var n = arguments[t];
            for (var r in n) Object.prototype.hasOwnProperty.call(n, r) && (e[r] = n[r]);
          }
          return e;
        }),
    Ir.apply(this, arguments)
  );
}
const Wi = g.createContext(null),
  Rh = g.createContext(null),
  Hn = g.createContext(null),
  mo = g.createContext(null),
  vt = g.createContext({ outlet: null, matches: [], isDataRoute: !1 }),
  Kd = g.createContext(null);
function Hr() {
  return g.useContext(mo) != null;
}
function Qn() {
  return (Hr() || q(!1), g.useContext(mo).location);
}
function bd(e) {
  g.useContext(Hn).static || g.useLayoutEffect(e);
}
function Dh() {
  let { isDataRoute: e } = g.useContext(vt);
  return e ? Yh() : zh();
}
function zh() {
  Hr() || q(!1);
  let e = g.useContext(Wi),
    { basename: t, future: n, navigator: r } = g.useContext(Hn),
    { matches: l } = g.useContext(vt),
    { pathname: o } = Qn(),
    a = JSON.stringify(Wd(l, n.v7_relativeSplatPath)),
    i = g.useRef(!1);
  return (
    bd(() => {
      i.current = !0;
    }),
    g.useCallback(
      function (c, m) {
        if ((m === void 0 && (m = {}), !i.current)) return;
        if (typeof c == 'number') {
          r.go(c);
          return;
        }
        let d = Hd(c, JSON.parse(a), o, m.relative === 'path');
        (e == null && t !== '/' && (d.pathname = d.pathname === '/' ? t : Zt([t, d.pathname])),
          (m.replace ? r.replace : r.push)(d, m.state, m));
      },
      [t, r, a, o, e],
    )
  );
}
const Ih = g.createContext(null);
function Mh(e) {
  let t = g.useContext(vt).outlet;
  return t && g.createElement(Ih.Provider, { value: e }, t);
}
function Yd() {
  let { matches: e } = g.useContext(vt),
    t = e[e.length - 1];
  return t ? t.params : {};
}
function Fh(e, t) {
  return $h(e, t);
}
function $h(e, t, n, r) {
  Hr() || q(!1);
  let { navigator: l, static: o } = g.useContext(Hn),
    { matches: a } = g.useContext(vt),
    i = a[a.length - 1],
    u = i ? i.params : {};
  i && i.pathname;
  let c = i ? i.pathnameBase : '/';
  i && i.route;
  let m = Qn(),
    d;
  if (t) {
    var f;
    let h = typeof t == 'string' ? Wn(t) : t;
    (c === '/' || ((f = h.pathname) != null && f.startsWith(c)) || q(!1), (d = h));
  } else d = m;
  let y = d.pathname || '/',
    S = y;
  if (c !== '/') {
    let h = c.replace(/^\//, '').split('/');
    S = '/' + y.replace(/^\//, '').split('/').slice(h.length).join('/');
  }
  let x = uh(e, { pathname: S }),
    E = Wh(
      x &&
        x.map((h) =>
          Object.assign({}, h, {
            params: Object.assign({}, u, h.params),
            pathname: Zt([
              c,
              l.encodeLocation ? l.encodeLocation(h.pathname).pathname : h.pathname,
            ]),
            pathnameBase:
              h.pathnameBase === '/'
                ? c
                : Zt([
                    c,
                    l.encodeLocation ? l.encodeLocation(h.pathnameBase).pathname : h.pathnameBase,
                  ]),
          }),
        ),
      a,
      n,
      r,
    );
  return t && E
    ? g.createElement(
        mo.Provider,
        {
          value: {
            location: Ir({ pathname: '/', search: '', hash: '', state: null, key: 'default' }, d),
            navigationType: Ct.Pop,
          },
        },
        E,
      )
    : E;
}
function Ah() {
  let e = bh(),
    t = Oh(e) ? e.status + ' ' + e.statusText : e instanceof Error ? e.message : JSON.stringify(e),
    n = e instanceof Error ? e.stack : null,
    l = { padding: '0.5rem', backgroundColor: 'rgba(200,200,200, 0.5)' };
  return g.createElement(
    g.Fragment,
    null,
    g.createElement('h2', null, 'Unexpected Application Error!'),
    g.createElement('h3', { style: { fontStyle: 'italic' } }, t),
    n ? g.createElement('pre', { style: l }, n) : null,
    null,
  );
}
const Uh = g.createElement(Ah, null);
class Bh extends g.Component {
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
      ? g.createElement(
          vt.Provider,
          { value: this.props.routeContext },
          g.createElement(Kd.Provider, { value: this.state.error, children: this.props.component }),
        )
      : this.props.children;
  }
}
function Vh(e) {
  let { routeContext: t, match: n, children: r } = e,
    l = g.useContext(Wi);
  return (
    l &&
      l.static &&
      l.staticContext &&
      (n.route.errorElement || n.route.ErrorBoundary) &&
      (l.staticContext._deepestRenderedBoundaryId = n.route.id),
    g.createElement(vt.Provider, { value: t }, r)
  );
}
function Wh(e, t, n, r) {
  var l;
  if (
    (t === void 0 && (t = []), n === void 0 && (n = null), r === void 0 && (r = null), e == null)
  ) {
    var o;
    if (!n) return null;
    if (n.errors) e = n.matches;
    else if (
      (o = r) != null &&
      o.v7_partialHydration &&
      t.length === 0 &&
      !n.initialized &&
      n.matches.length > 0
    )
      e = n.matches;
    else return null;
  }
  let a = e,
    i = (l = n) == null ? void 0 : l.errors;
  if (i != null) {
    let m = a.findIndex((d) => d.route.id && (i == null ? void 0 : i[d.route.id]) !== void 0);
    (m >= 0 || q(!1), (a = a.slice(0, Math.min(a.length, m + 1))));
  }
  let u = !1,
    c = -1;
  if (n && r && r.v7_partialHydration)
    for (let m = 0; m < a.length; m++) {
      let d = a[m];
      if (((d.route.HydrateFallback || d.route.hydrateFallbackElement) && (c = m), d.route.id)) {
        let { loaderData: f, errors: y } = n,
          S = d.route.loader && f[d.route.id] === void 0 && (!y || y[d.route.id] === void 0);
        if (d.route.lazy || S) {
          ((u = !0), c >= 0 ? (a = a.slice(0, c + 1)) : (a = [a[0]]));
          break;
        }
      }
    }
  return a.reduceRight((m, d, f) => {
    let y,
      S = !1,
      x = null,
      E = null;
    n &&
      ((y = i && d.route.id ? i[d.route.id] : void 0),
      (x = d.route.errorElement || Uh),
      u &&
        (c < 0 && f === 0
          ? (Gh('route-fallback'), (S = !0), (E = null))
          : c === f && ((S = !0), (E = d.route.hydrateFallbackElement || null))));
    let h = t.concat(a.slice(0, f + 1)),
      p = () => {
        let v;
        return (
          y
            ? (v = x)
            : S
              ? (v = E)
              : d.route.Component
                ? (v = g.createElement(d.route.Component, null))
                : d.route.element
                  ? (v = d.route.element)
                  : (v = m),
          g.createElement(Vh, {
            match: d,
            routeContext: { outlet: m, matches: h, isDataRoute: n != null },
            children: v,
          })
        );
      };
    return n && (d.route.ErrorBoundary || d.route.errorElement || f === 0)
      ? g.createElement(Bh, {
          location: n.location,
          revalidation: n.revalidation,
          component: x,
          error: y,
          children: p(),
          routeContext: { outlet: null, matches: h, isDataRoute: !0 },
        })
      : p();
  }, null);
}
var Gd = (function (e) {
    return (
      (e.UseBlocker = 'useBlocker'),
      (e.UseRevalidator = 'useRevalidator'),
      (e.UseNavigateStable = 'useNavigate'),
      e
    );
  })(Gd || {}),
  Xd = (function (e) {
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
  })(Xd || {});
function Hh(e) {
  let t = g.useContext(Wi);
  return (t || q(!1), t);
}
function Qh(e) {
  let t = g.useContext(Rh);
  return (t || q(!1), t);
}
function Kh(e) {
  let t = g.useContext(vt);
  return (t || q(!1), t);
}
function Jd(e) {
  let t = Kh(),
    n = t.matches[t.matches.length - 1];
  return (n.route.id || q(!1), n.route.id);
}
function bh() {
  var e;
  let t = g.useContext(Kd),
    n = Qh(),
    r = Jd();
  return t !== void 0 ? t : (e = n.errors) == null ? void 0 : e[r];
}
function Yh() {
  let { router: e } = Hh(Gd.UseNavigateStable),
    t = Jd(Xd.UseNavigateStable),
    n = g.useRef(!1);
  return (
    bd(() => {
      n.current = !0;
    }),
    g.useCallback(
      function (l, o) {
        (o === void 0 && (o = {}),
          n.current &&
            (typeof l == 'number' ? e.navigate(l) : e.navigate(l, Ir({ fromRouteId: t }, o))));
      },
      [e, t],
    )
  );
}
const mu = {};
function Gh(e, t, n) {
  mu[e] || (mu[e] = !0);
}
function Xh(e, t) {
  (e == null || e.v7_startTransition, e == null || e.v7_relativeSplatPath);
}
function Jh(e) {
  let { to: t, replace: n, state: r, relative: l } = e;
  Hr() || q(!1);
  let { future: o, static: a } = g.useContext(Hn),
    { matches: i } = g.useContext(vt),
    { pathname: u } = Qn(),
    c = Dh(),
    m = Hd(t, Wd(i, o.v7_relativeSplatPath), u, l === 'path'),
    d = JSON.stringify(m);
  return (
    g.useEffect(() => c(JSON.parse(d), { replace: n, state: r, relative: l }), [c, d, l, n, r]),
    null
  );
}
function Zh(e) {
  return Mh(e.context);
}
function De(e) {
  q(!1);
}
function qh(e) {
  let {
    basename: t = '/',
    children: n = null,
    location: r,
    navigationType: l = Ct.Pop,
    navigator: o,
    static: a = !1,
    future: i,
  } = e;
  Hr() && q(!1);
  let u = t.replace(/^\/*/, '/'),
    c = g.useMemo(
      () => ({ basename: u, navigator: o, static: a, future: Ir({ v7_relativeSplatPath: !1 }, i) }),
      [u, i, o, a],
    );
  typeof r == 'string' && (r = Wn(r));
  let { pathname: m = '/', search: d = '', hash: f = '', state: y = null, key: S = 'default' } = r,
    x = g.useMemo(() => {
      let E = Vd(m, u);
      return E == null
        ? null
        : { location: { pathname: E, search: d, hash: f, state: y, key: S }, navigationType: l };
    }, [u, m, d, f, y, S, l]);
  return x == null
    ? null
    : g.createElement(
        Hn.Provider,
        { value: c },
        g.createElement(mo.Provider, { children: n, value: x }),
      );
}
function ev(e) {
  let { children: t, location: n } = e;
  return Fh(Ba(t), n);
}
new Promise(() => {});
function Ba(e, t) {
  t === void 0 && (t = []);
  let n = [];
  return (
    g.Children.forEach(e, (r, l) => {
      if (!g.isValidElement(r)) return;
      let o = [...t, l];
      if (r.type === g.Fragment) {
        n.push.apply(n, Ba(r.props.children, o));
        return;
      }
      (r.type !== De && q(!1), !r.props.index || !r.props.children || q(!1));
      let a = {
        id: r.props.id || o.join('-'),
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
      (r.props.children && (a.children = Ba(r.props.children, o)), n.push(a));
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
 */ const tv = '6';
try {
  window.__reactRouterVersion = tv;
} catch {}
const nv = 'startTransition',
  hu = Yf[nv];
function rv(e) {
  let { basename: t, children: n, future: r, window: l } = e,
    o = g.useRef();
  o.current == null && (o.current = ah({ window: l, v5Compat: !0 }));
  let a = o.current,
    [i, u] = g.useState({ action: a.action, location: a.location }),
    { v7_startTransition: c } = r || {},
    m = g.useCallback(
      (d) => {
        c && hu ? hu(() => u(d)) : u(d);
      },
      [u, c],
    );
  return (
    g.useLayoutEffect(() => a.listen(m), [a, m]),
    g.useEffect(() => Xh(r), [r]),
    g.createElement(qh, {
      basename: t,
      children: n,
      location: i.location,
      navigationType: i.action,
      navigator: a,
      future: r,
    })
  );
}
var vu;
(function (e) {
  ((e.UseScrollRestoration = 'useScrollRestoration'),
    (e.UseSubmit = 'useSubmit'),
    (e.UseSubmitFetcher = 'useSubmitFetcher'),
    (e.UseFetcher = 'useFetcher'),
    (e.useViewTransitionState = 'useViewTransitionState'));
})(vu || (vu = {}));
var gu;
(function (e) {
  ((e.UseFetcher = 'useFetcher'),
    (e.UseFetchers = 'useFetchers'),
    (e.UseScrollRestoration = 'useScrollRestoration'));
})(gu || (gu = {}));
const lv = { 'system.StorePausedNotice': { to: 'system.PauseNotice', codemod: 'c3-rehearsal' } };
const qe = { cart: '/sacola', checkout: '/checkout', order: '/pedido/:id', orders: '/pedidos' };
function An(e) {
  var t, n;
  return {
    home: '/',
    catalog: ((t = e.paths) == null ? void 0 : t.catalog) ?? '/cardapio',
    product: ((n = e.paths) == null ? void 0 : n.product) ?? '/produto/:slug',
    ...qe,
  };
}
function Zd(e, t) {
  return An(e).product.replace(':slug', encodeURIComponent(t));
}
class Mr extends Error {
  constructor(t, n, r, l) {
    (super(r), (this.status = t), (this.code = n), (this.details = l));
  }
}
const Hi = 'vendua.session',
  qd = 'vendua.orderTokens';
function Va() {
  var e;
  try {
    return JSON.parse(((e = globalThis.sessionStorage) == null ? void 0 : e.getItem(qd)) ?? '{}');
  } catch {
    return {};
  }
}
function ov(e, t) {
  var n;
  try {
    const r = Va();
    r[e] = t;
    for (const l of Object.keys(r).slice(0, -20)) delete r[l];
    (n = globalThis.sessionStorage) == null || n.setItem(qd, JSON.stringify(r));
  } catch {}
}
function av() {
  var e;
  try {
    return ((e = globalThis.sessionStorage) == null ? void 0 : e.getItem(Hi)) ?? null;
  } catch {
    return null;
  }
}
function iv(e) {
  var t;
  try {
    (t = globalThis.sessionStorage) == null || t.setItem(Hi, e);
  } catch {}
}
async function de(e, t) {
  let n;
  try {
    n = await fetch(e, {
      ...t,
      headers: { 'content-type': 'application/json', ...((t == null ? void 0 : t.headers) ?? {}) },
    });
  } catch {
    throw new Mr(0, 'NETWORK_ERROR', 'could not reach the store backend');
  }
  const r = await n.json().catch(() => ({}));
  if (!n.ok) {
    const l = r == null ? void 0 : r.error;
    throw new Mr(
      n.status,
      (l == null ? void 0 : l.code) ?? 'INTERNAL',
      (l == null ? void 0 : l.message) ?? n.statusText,
      l == null ? void 0 : l.details,
    );
  }
  return r;
}
function xt() {
  var e, t;
  return (
    ((t = (e = globalThis.crypto) == null ? void 0 : e.randomUUID) == null ? void 0 : t.call(e)) ??
    `k-${Date.now()}-${Math.random()}`
  );
}
function sv(e = '') {
  const t = (d) => `${e}/storefront/v1${d}`,
    n = (d) => `${e}/checkout/v1${d}`;
  let r = av(),
    l = null;
  const o = new Map();
  let a = Promise.resolve();
  const i = () => (r ? { authorization: `Bearer ${r}` } : {}),
    u = () => de(n('/cart'), { headers: i() }),
    c = () => {
      var d;
      r = null;
      try {
        (d = globalThis.sessionStorage) == null || d.removeItem(Hi);
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
              if (!(f instanceof Mr) || f.status !== 401) throw f;
            }
          const d = await de(n('/session'), {
            method: 'POST',
            headers: { ...i(), 'idempotency-key': xt() },
          });
          return ((r = d.sessionToken), iv(r), { cart: d.cart });
        })().finally(() => {
          l = null;
        })),
      l
    );
  return {
    get sessionToken() {
      return r;
    },
    store: () => de(t('/store')),
    catalog: () => de(t('/catalog')),
    product: (d) => de(t(`/products/${d}`)),
    surfaces: (d) => de(t(`/surfaces${d === void 0 ? '' : `?zoneMatched=${d}`}`)),
    zones: () => de(t('/zones')),
    state: (d = !1) => de(t(`/state${d ? '?templates=1' : ''}`)),
    notifyMe: (d) =>
      de(n('/notify-me'), {
        method: 'POST',
        headers: { 'idempotency-key': xt() },
        body: JSON.stringify(d),
      }),
    orderIds: () => [...new Set([...o.keys(), ...Object.keys(Va())])].reverse(),
    quote: (d) =>
      de(n('/quote'), {
        method: 'POST',
        headers: { 'idempotency-key': xt() },
        body: JSON.stringify({ neighborhood: d }),
      }),
    clearSession: c,
    ensureSession: m,
    cart: u,
    async addItem(d, f = 1, y = []) {
      return (
        await m(),
        (
          await de(n('/cart/items'), {
            method: 'POST',
            headers: { ...i(), 'idempotency-key': xt() },
            body: JSON.stringify({ productId: d, qty: f, modifierIds: y }),
          })
        ).cart
      );
    },
    updateItem: (d, f) =>
      de(n(`/cart/items/${d}`), {
        method: 'PATCH',
        headers: { ...i(), 'idempotency-key': xt() },
        body: JSON.stringify({ qty: f }),
      }).then((y) => y.cart),
    removeItem: (d) =>
      de(n(`/cart/items/${d}`), {
        method: 'DELETE',
        headers: { ...i(), 'idempotency-key': xt() },
      }).then((f) => f.cart),
    setDelivery: (d) => {
      const f = r,
        y = f ? { authorization: `Bearer ${f}` } : {},
        S = a.then(() =>
          de(n('/cart/delivery'), {
            method: 'POST',
            headers: { ...y, 'idempotency-key': xt() },
            body: JSON.stringify(d),
          }).then((x) => x.cart),
        );
      return ((a = S.catch(() => {})), S);
    },
    async checkout(d) {
      const f = await de(n('/checkout'), {
        method: 'POST',
        headers: { ...i(), 'idempotency-key': xt() },
        body: JSON.stringify(d),
      });
      r && (o.set(f.order.id, r), ov(f.order.id, r));
      try {
        (c(), await m());
      } catch {}
      return f.order;
    },
    order: (d) => {
      const f = o.get(d) ?? Va()[d] ?? r;
      return de(n(`/orders/${d}`), { headers: f ? { authorization: `Bearer ${f}` } : {} }).then(
        (y) => y.order,
      );
    },
  };
}
const uv = {
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
  cv = { title: 'Não foi possível concluir', body: 'Tente novamente em instantes.' };
function Wa(e) {
  return uv[e] ?? cv;
}
function ef(e) {
  return e instanceof Mr || (e && typeof e == 'object' && typeof e.code == 'string')
    ? e.code
    : 'INTERNAL';
}
let qt = [];
const Ha = new Set(),
  tf = () => Ha.forEach((e) => e()),
  dv = new Set(['STORE_PAUSED', 'STORE_CLOSED', 'TENANT_SUSPENDED']);
let Cl = null;
function yu(e) {
  Cl = e;
}
function ho(e) {
  const t = ef(e),
    n = Wa(t),
    r = `error:${t}`;
  ((qt = [
    ...qt.filter((l) => l.id !== r),
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
    tf(),
    setTimeout(() => nf(r), 8e3),
    dv.has(t) && (Cl == null || Cl()));
}
function nf(e) {
  const t = qt.filter((n) => n.id !== e);
  t.length !== qt.length && ((qt = t), tf());
}
function fv() {
  return g.useSyncExternalStore(
    (e) => (Ha.add(e), () => Ha.delete(e)),
    () => qt,
    () => qt,
  );
}
const xu = 'vendua.sid',
  rf = 'vendua.consent',
  pv = 20,
  mv = 4e3;
function Qa() {
  var e, t;
  return (
    ((t = (e = globalThis.crypto) == null ? void 0 : e.randomUUID) == null ? void 0 : t.call(e)) ??
    `${Date.now()}-${Math.random()}`
  ).replace(/[^A-Za-z0-9_-]/g, '');
}
function hv() {
  var e, t;
  try {
    let n = (e = globalThis.sessionStorage) == null ? void 0 : e.getItem(xu);
    return (
      n || ((n = Qa().slice(0, 32)), (t = globalThis.sessionStorage) == null || t.setItem(xu, n)),
      n
    );
  } catch {
    return vv ?? (vv = Qa().slice(0, 32));
  }
}
let vv;
function gv() {
  var e;
  try {
    const t = (e = globalThis.localStorage) == null ? void 0 : e.getItem(rf),
      n = t ? JSON.parse(t) : null;
    return (n == null ? void 0 : n.version) === 1 && Array.isArray(n.purposes) ? n : null;
  } catch {
    return null;
  }
}
function yv(e) {
  var n;
  const t = { version: 1, purposes: e, at: new Date().toISOString() };
  try {
    (n = globalThis.localStorage) == null || n.setItem(rf, JSON.stringify(t));
  } catch {}
  return ((lf = t), Ka.forEach((r) => r()), t);
}
let lf = null;
const Ka = new Set();
function xv(e) {
  return (Ka.add(e), () => Ka.delete(e));
}
function kv() {
  return lf ?? gv();
}
class Sv {
  constructor() {
    dn(this, 'queue', []);
    dn(this, 'timer', null);
    dn(this, 'baseUrl', '');
    dn(this, 'wired', !1);
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
      this.queue.length >= pv
        ? this.flush()
        : (this.timer ?? (this.timer = setTimeout(() => this.flush(), mv))));
  }
  flush(t = !1) {
    if ((this.timer && clearTimeout(this.timer), (this.timer = null), this.queue.length === 0))
      return;
    const n = this.queue.splice(0, 50),
      r = JSON.stringify({ batchId: Qa().slice(0, 32), sessionId: hv(), events: n }),
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
const of = new Sv();
function Ue(e, t = {}) {
  of.push(e, t);
}
function vo(e) {
  const t = { ...e, at: Date.now() },
    n = globalThis;
  ((n.__VENDUA_REPORTS__ ?? (n.__VENDUA_REPORTS__ = [])).push(t),
    n.__VENDUA_REPORTS__.length > 100 && n.__VENDUA_REPORTS__.splice(0, 50),
    Ue(e.kind === 'slot_error' || e.kind === 'section_error' ? 'slot_error' : 'section_unknown', {
      kind: e.kind,
      target: e.target,
      message: e.message.slice(0, 200),
    }),
    console.warn(`[vendua] ${e.kind}: ${e.target} — ${e.message}`));
}
const af = g.createContext(null);
function G() {
  const e = g.useContext(af);
  if (!e) throw new Error('useKernel must be used inside <VenduaProvider>');
  return e;
}
function wv(e) {
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
const Ev = { sections: {}, snapshot: { templates: {}, tokens: null } };
function jv({ config: e, storefront: t = Ev, baseUrl: n = '', children: r }) {
  var c;
  const l = t.snapshot.tokens ?? e.tokens,
    o = g.useRef();
  (!o.current || o.current.baseUrl !== n) &&
    ((c = o.current) == null || c.api.clearSession(), (o.current = { api: sv(n), baseUrl: n }));
  const a = o.current.api,
    i = g.useRef(new Map()),
    u = g.useMemo(
      () => ({
        api: a,
        config: e,
        tokens: l,
        storefront: t,
        invalidate(m) {
          var d;
          (d = i.current.get(m)) == null || d.forEach((f) => f());
        },
        subscribe(m, d) {
          let f = i.current.get(m);
          return (f || i.current.set(m, (f = new Set())), f.add(d), () => f.delete(d));
        },
      }),
      [e, a, l, t],
    );
  return (
    g.useEffect(
      () => (
        of.configure(n),
        yu(() => {
          for (const m of ['store', 'surfaces:any', 'surfaces:true', 'surfaces:false']) Ki(m);
        }),
        () => yu(null)
      ),
      [n],
    ),
    g.useEffect(() => {
      const m = document.documentElement,
        d = wv(l);
      for (const [f, y] of Object.entries(d)) m.style.setProperty(f, y);
      return () => {
        for (const f of Object.keys(d)) m.style.removeProperty(f);
      };
    }, [l]),
    g.useEffect(() => {
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
    g.useEffect(() => {
      const m = { cache: Qi(a), invalidate: u.invalidate };
      return (
        ba.add(m),
        () => {
          ba.delete(m);
        }
      );
    }, [a, u.invalidate]),
    g.useEffect(() => {
      globalThis.__VENDUA_KERNEL_MOUNTED__ = !0;
      const m = document.getElementById('vendua-loader-overlay');
      (m == null ? void 0 : m.dataset.mode) !== 'maintenance' && (m == null || m.remove());
    }, []),
    s.jsx(af.Provider, { value: u, children: r })
  );
}
const ku = new WeakMap();
function Qi(e) {
  let t = ku.get(e);
  return (t || ku.set(e, (t = new Map())), t);
}
function gt(e, t) {
  const { api: n, subscribe: r, invalidate: l } = G(),
    [, o] = g.useState(0),
    a = Qi(n),
    i = a.get(e) ?? {};
  return (
    g.useEffect(() => {
      var d;
      let u = !0;
      const c = () => {
        const f = a.get(e) ?? {};
        if (f.inflight) {
          f.inflight.finally(() => {
            u && o((S) => S + 1);
          });
          return;
        }
        const y = Symbol(e);
        ((f.runToken = y),
          (f.inflight = t()
            .then((S) => {
              const x = a.get(e);
              (x == null ? void 0 : x.runToken) === y && a.set(e, { resolved: !0, data: S });
            })
            .catch((S) => {
              const x = a.get(e);
              (x == null ? void 0 : x.runToken) === y && a.set(e, { resolved: !0, error: S });
            })
            .finally(() => {
              u && o((S) => S + 1);
            })),
          a.set(e, f));
      };
      (!i.inflight && (!i.resolved || i.error) && c(),
        (d = i.inflight) == null ||
          d.finally(() => {
            u && o((f) => f + 1);
          }));
      const m = r(e, c);
      return () => {
        ((u = !1), m());
      };
    }, [e, n]),
    {
      data: i.data,
      error: i.error,
      loading: !i.resolved && !i.error,
      refetch: () => {
        (a.delete(e), l(e));
      },
    }
  );
}
const ba = new Set();
function Nv(e, t, n) {
  const r = Qi(e),
    l = r.get(t);
  if ((l != null && l.resolved) || (l != null && l.inflight)) return;
  const o = Symbol(t),
    a = { runToken: o };
  ((a.inflight = n()
    .then((i) => {
      var u;
      ((u = r.get(t)) == null ? void 0 : u.runToken) === o && r.set(t, { resolved: !0, data: i });
    })
    .catch((i) => {
      var u;
      ((u = r.get(t)) == null ? void 0 : u.runToken) === o && r.set(t, { resolved: !0, error: i });
    })),
    r.set(t, a));
}
function Ki(e, t) {
  for (const n of ba)
    (t !== void 0 ? n.cache.set(e, { resolved: !0, data: t }) : n.cache.delete(e), n.invalidate(e));
}
function le(e, t = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: t }).format(e / 100);
}
function bi(e, t) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(e));
}
const go = {
    placed: 'Pedido recebido',
    confirmed: 'Pedido confirmado',
    preparing: 'Em preparo',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
    refunded: 'Reembolsado',
  },
  sf = { pix: 'Pix', card_on_delivery: 'Cartão na entrega', cash: 'Dinheiro' };
function Cv({ steps: e, current: t, onStep: n, children: r }) {
  return s.jsxs('div', {
    className: 'v-checkout',
    'data-part': 'root',
    children: [
      s.jsx('ol', {
        className: 'v-steps',
        'data-part': 'steps',
        'aria-label': 'Etapas do pedido',
        children: e.map((l, o) =>
          s.jsx(
            'li',
            {
              className: 'v-step',
              'data-part': 'step',
              'data-state': l.id === t ? 'current' : l.done ? 'done' : 'todo',
              'aria-current': l.id === t ? 'step' : void 0,
              children:
                l.done && l.id !== t
                  ? s.jsxs('button', {
                      type: 'button',
                      className: 'v-step-btn',
                      onClick: () => n(l.id),
                      children: [
                        s.jsx('span', { className: 'v-step-n', children: o + 1 }),
                        ' ',
                        l.label,
                      ],
                    })
                  : s.jsxs('span', {
                      className: 'v-step-btn',
                      children: [
                        s.jsx('span', { className: 'v-step-n', children: o + 1 }),
                        ' ',
                        l.label,
                      ],
                    }),
            },
            l.id,
          ),
        ),
      }),
      s.jsx('div', { className: 'v-checkout-body', 'data-part': 'body', children: r }),
    ],
  });
}
function _v({ cart: e, currency: t }) {
  var r;
  const n = e.totals;
  return s.jsxs('section', {
    className: 'v-summary',
    'data-vendua': 'checkout-summary',
    'data-part': 'root',
    'aria-label': 'Resumo do pedido',
    children: [
      s.jsx('ul', {
        className: 'v-summary-lines',
        'data-part': 'lines',
        children: e.items.map((l) =>
          s.jsxs(
            'li',
            {
              className: 'v-summary-line',
              children: [
                s.jsxs('span', { children: [l.qty, '× ', l.name] }),
                s.jsx('span', { className: 'v-num', children: le(l.lineTotalCents, t) }),
              ],
            },
            l.id,
          ),
        ),
      }),
      s.jsxs('dl', {
        className: 'v-summary-totals',
        'data-part': 'totals',
        children: [
          s.jsxs('div', {
            children: [
              s.jsx('dt', { children: 'Subtotal' }),
              s.jsx('dd', {
                className: 'v-num',
                'data-vendua': 'subtotal',
                children: le(n.subtotalCents, t),
              }),
            ],
          }),
          ((r = e.delivery) == null ? void 0 : r.mode) === 'delivery'
            ? s.jsxs('div', {
                children: [
                  s.jsxs('dt', {
                    children: [
                      'Entrega',
                      e.delivery.neighborhood ? ` · ${e.delivery.neighborhood}` : '',
                    ],
                  }),
                  s.jsx('dd', {
                    className: 'v-num',
                    'data-vendua': 'delivery-fee',
                    children: n.deliveryFeeCents > 0 ? le(n.deliveryFeeCents, t) : 'grátis',
                  }),
                ],
              })
            : null,
          s.jsxs('div', {
            className: 'v-summary-total',
            children: [
              s.jsx('dt', { children: 'Total' }),
              s.jsx('dd', {
                className: 'v-num',
                'data-vendua': 'total',
                children: le(n.totalCents, t),
              }),
            ],
          }),
        ],
      }),
      n.belowMinOrder
        ? s.jsxs('p', {
            className: 'v-alert',
            role: 'status',
            'data-part': 'min-order',
            children: [
              'Faltam ',
              le(n.remainingMinOrderCents, t),
              ' para o pedido mínimo de',
              ' ',
              le(n.minOrderCents, t),
              '.',
            ],
          })
        : null,
    ],
  });
}
function pn({ id: e, label: t, error: n, children: r }) {
  return s.jsxs('div', {
    className: 'v-field',
    'data-part': 'field',
    'data-invalid': n ? !0 : void 0,
    children: [
      s.jsx('label', { className: 'v-label', htmlFor: e, children: t }),
      r,
      n
        ? s.jsx('p', { className: 'v-field-error', id: `${e}-error`, role: 'alert', children: n })
        : null,
    ],
  });
}
function Pv({ value: e, onChange: t, errors: n, part: r, neighborhoods: l }) {
  const o = (i) => n[i],
    a = (i) => (n[i] ? { 'aria-invalid': !0, 'aria-describedby': `checkout-${i}-error` } : {});
  return r === 'customer'
    ? s.jsxs('fieldset', {
        className: 'v-fieldset',
        'data-part': 'root',
        children: [
          s.jsx('legend', { className: 'v-legend', children: 'Seus dados' }),
          s.jsx(pn, {
            id: 'checkout-name',
            label: 'Nome',
            error: o('name'),
            children: s.jsx('input', {
              id: 'checkout-name',
              name: 'name',
              className: 'v-input',
              autoComplete: 'name',
              maxLength: 120,
              value: e.name,
              onChange: (i) => t({ name: i.target.value }),
              ...a('name'),
            }),
          }),
          s.jsx(pn, {
            id: 'checkout-phone',
            label: 'WhatsApp',
            error: o('phone'),
            children: s.jsx('input', {
              id: 'checkout-phone',
              name: 'phone',
              type: 'tel',
              inputMode: 'tel',
              className: 'v-input',
              autoComplete: 'tel',
              maxLength: 20,
              placeholder: '(00) 00000-0000',
              value: e.phone,
              onChange: (i) => t({ phone: i.target.value }),
              ...a('phone'),
            }),
          }),
          s.jsxs('label', {
            className: 'v-check',
            'data-part': 'remember',
            children: [
              s.jsx('input', {
                type: 'checkbox',
                checked: e.remember,
                onChange: (i) => t({ remember: i.target.checked }),
              }),
              ' ',
              'Lembrar meus dados neste aparelho',
            ],
          }),
        ],
      })
    : s.jsxs('fieldset', {
        className: 'v-fieldset',
        'data-part': 'root',
        children: [
          s.jsx('legend', { className: 'v-legend', children: 'Endereço de entrega' }),
          s.jsxs(pn, {
            id: 'checkout-neighborhood',
            label: 'Bairro',
            error: o('neighborhood'),
            children: [
              s.jsx('input', {
                id: 'checkout-neighborhood',
                name: 'neighborhood',
                className: 'v-input',
                list: 'checkout-neighborhoods',
                maxLength: 80,
                value: e.neighborhood,
                onChange: (i) => t({ neighborhood: i.target.value }),
                ...a('neighborhood'),
              }),
              s.jsx('datalist', {
                id: 'checkout-neighborhoods',
                children: l.map((i) => s.jsx('option', { value: i }, i)),
              }),
            ],
          }),
          s.jsxs('div', {
            className: 'v-field-row',
            children: [
              s.jsx(pn, {
                id: 'checkout-street',
                label: 'Rua',
                error: o('street'),
                children: s.jsx('input', {
                  id: 'checkout-street',
                  name: 'street',
                  className: 'v-input',
                  autoComplete: 'address-line1',
                  maxLength: 120,
                  value: e.street,
                  onChange: (i) => t({ street: i.target.value }),
                  ...a('street'),
                }),
              }),
              s.jsx(pn, {
                id: 'checkout-number',
                label: 'Número',
                error: o('number'),
                children: s.jsx('input', {
                  id: 'checkout-number',
                  name: 'number',
                  className: 'v-input v-input-short',
                  inputMode: 'numeric',
                  maxLength: 10,
                  value: e.number,
                  onChange: (i) => t({ number: i.target.value }),
                  ...a('number'),
                }),
              }),
            ],
          }),
          s.jsx(pn, {
            id: 'checkout-complement',
            label: 'Complemento (opcional)',
            error: o('complement'),
            children: s.jsx('input', {
              id: 'checkout-complement',
              name: 'complement',
              className: 'v-input',
              autoComplete: 'address-line2',
              maxLength: 80,
              value: e.complement,
              onChange: (i) => t({ complement: i.target.value }),
            }),
          }),
        ],
      });
}
function Tv({ options: e, selected: t, onSelect: n }) {
  return s.jsxs('fieldset', {
    className: 'v-fieldset',
    'data-part': 'root',
    children: [
      s.jsx('legend', { className: 'v-legend', children: 'Como você quer receber?' }),
      s.jsx('div', {
        className: 'v-options',
        role: 'radiogroup',
        'aria-label': 'Entrega ou retirada',
        children: e.map((r) =>
          s.jsxs(
            'label',
            {
              className: 'v-option',
              'data-part': 'option',
              'data-selected': r.mode === t || void 0,
              children: [
                s.jsx('input', {
                  type: 'radio',
                  name: 'delivery-mode',
                  value: r.mode,
                  checked: r.mode === t,
                  disabled: r.disabled,
                  onChange: () => n(r.mode),
                }),
                s.jsx('span', { className: 'v-option-label', children: r.label }),
                r.detail
                  ? s.jsx('span', { className: 'v-option-detail v-muted', children: r.detail })
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
function Ov({ methods: e, selected: t, onSelect: n }) {
  return s.jsxs('fieldset', {
    className: 'v-fieldset',
    'data-part': 'root',
    children: [
      s.jsx('legend', { className: 'v-legend', children: 'Pagamento' }),
      s.jsx('div', {
        className: 'v-options',
        role: 'radiogroup',
        'aria-label': 'Forma de pagamento',
        children: e.map((r) =>
          s.jsxs(
            'label',
            {
              className: 'v-option',
              'data-part': 'option',
              'data-selected': r.id === t || void 0,
              children: [
                s.jsx('input', {
                  type: 'radio',
                  name: 'payment-method',
                  value: r.id,
                  checked: r.id === t,
                  onChange: () => n(r.id),
                }),
                s.jsx('span', { className: 'v-option-label', children: r.label }),
                r.detail
                  ? s.jsx('span', { className: 'v-option-detail v-muted', children: r.detail })
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
function Lv({ order: e, currency: t }) {
  return s.jsxs('section', {
    className: 'v-panel v-success',
    'data-vendua': 'checkout-success',
    'data-part': 'root',
    role: 'status',
    children: [
      s.jsxs('h1', {
        className: 'v-page-title',
        'data-part': 'title',
        children: ['Pedido #', e.number, ' recebido!'],
      }),
      s.jsxs('p', {
        className: 'v-muted',
        'data-part': 'body',
        children: [
          go[e.state] ?? e.state,
          ' · ',
          le(e.totalCents, t),
          ' ·',
          ' ',
          sf[e.payment.method] ?? e.payment.method,
        ],
      }),
      e.payment.instructions
        ? s.jsx('p', {
            className: 'v-note',
            'data-part': 'instructions',
            children: e.payment.instructions,
          })
        : null,
    ],
  });
}
function Rv({ onBrowse: e }) {
  return s.jsxs('div', {
    className: 'v-panel v-empty',
    'data-vendua': 'empty-cart',
    'data-part': 'root',
    children: [
      s.jsx('p', {
        className: 'v-panel-title',
        'data-part': 'title',
        children: 'Sua sacola está vazia.',
      }),
      s.jsx('button', {
        type: 'button',
        className: 'v-btn v-btn-accent',
        'data-part': 'browse',
        onClick: e,
        children: 'Ver cardápio',
      }),
    ],
  });
}
function Dv({ qty: e, min: t = 0, max: n = 99, pending: r, onChange: l, label: o = 'quantidade' }) {
  return s.jsxs('span', {
    className: 'v-qty',
    'data-vendua': 'qty-stepper',
    'data-part': 'qty',
    role: 'group',
    'aria-label': o,
    'data-pending': r || void 0,
    children: [
      s.jsx('button', {
        type: 'button',
        'aria-label': 'diminuir',
        disabled: r || e <= t,
        onClick: () => l(e - 1),
        children: '−',
      }),
      s.jsx('output', { 'aria-live': 'polite', children: e }),
      s.jsx('button', {
        type: 'button',
        'aria-label': 'aumentar',
        disabled: r || e >= n,
        onClick: () => l(e + 1),
        children: '+',
      }),
    ],
  });
}
function zv({ cart: e, presentation: t, checkout: n, lines: r, summary: l, onClose: o }) {
  return s.jsxs('section', {
    className: 'v-cart',
    'data-part': 'root',
    'data-presentation': t,
    'aria-label': 'Sacola',
    children: [
      s.jsxs('header', {
        className: 'v-cart-head',
        'data-part': 'head',
        children: [
          s.jsx('h1', { className: 'v-page-title', children: 'Sacola' }),
          s.jsxs('p', {
            className: 'v-muted',
            children: [e.totals.itemCount, ' ', e.totals.itemCount === 1 ? 'item' : 'itens'],
          }),
          t === 'drawer'
            ? s.jsx('button', {
                type: 'button',
                className: 'v-btn v-btn-ghost',
                onClick: o,
                'aria-label': 'Fechar sacola',
                children: '×',
              })
            : null,
        ],
      }),
      s.jsxs('div', {
        className: 'v-cart-grid',
        children: [
          s.jsx('ol', { className: 'v-cart-lines', 'data-part': 'lines', children: r }),
          s.jsxs('aside', {
            className: 'v-cart-aside',
            'data-part': 'aside',
            children: [
              l,
              n,
              s.jsx('button', {
                type: 'button',
                className: 'v-btn v-btn-ghost v-btn-block',
                'data-part': 'continue',
                onClick: o,
                children: 'Continuar escolhendo',
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function Iv({ item: e, currency: t, pending: n, onQty: r, onRemove: l }) {
  const o = e.productStatus !== 'active';
  return s.jsxs('li', {
    className: 'v-line',
    'data-vendua': 'cart-line',
    'data-part': 'root',
    'data-unavailable': o || void 0,
    children: [
      s.jsxs('div', {
        className: 'v-line-main',
        children: [
          s.jsx('p', { className: 'v-line-name', 'data-part': 'name', children: e.name }),
          e.modifiers.length > 0
            ? s.jsx('p', {
                className: 'v-muted v-line-mods',
                'data-part': 'modifiers',
                children: e.modifiers
                  .map((a) =>
                    a.priceDeltaCents > 0 ? `${a.name} (+${le(a.priceDeltaCents, t)})` : a.name,
                  )
                  .join(', '),
              })
            : null,
          o
            ? s.jsx('p', {
                className: 'v-alert',
                role: 'status',
                children: 'Indisponível agora — remova para continuar.',
              })
            : null,
          s.jsxs('div', {
            className: 'v-line-actions',
            'data-part': 'actions',
            children: [
              s.jsx(Dv, { qty: e.qty, pending: n, onChange: r, label: `quantidade de ${e.name}` }),
              s.jsx('button', {
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
      s.jsx('p', {
        className: 'v-line-total v-num',
        'data-part': 'total',
        children: le(e.lineTotalCents, t),
      }),
    ],
  });
}
function Mv({ events: e }) {
  return s.jsx('ol', {
    className: 'v-timeline',
    'data-vendua': 'order-timeline',
    'data-part': 'root',
    children: e.map((t, n) =>
      s.jsxs(
        'li',
        {
          className: 'v-timeline-item',
          'data-part': 'event',
          'data-state': t.to,
          children: [
            s.jsx('span', { className: 'v-timeline-label', children: go[t.to] ?? t.to }),
            s.jsx('time', { className: 'v-muted', dateTime: t.at, children: bi(t.at) }),
          ],
        },
        `${t.at}-${n}`,
      ),
    ),
  });
}
function Fv({ order: e, currency: t, timeline: n }) {
  const r = e.delivery;
  return s.jsxs('section', {
    className: 'v-order',
    'data-vendua': 'order-status',
    'data-part': 'root',
    'data-state': e.state,
    children: [
      s.jsxs('header', {
        className: 'v-order-head',
        'data-part': 'head',
        children: [
          s.jsxs('p', { className: 'v-eyebrow', children: ['Pedido #', e.number] }),
          s.jsx('h1', {
            className: 'v-page-title',
            'data-part': 'state',
            children: go[e.state] ?? e.state,
          }),
          r.etaMin != null && r.etaMax != null && r.mode === 'delivery'
            ? s.jsxs('p', {
                className: 'v-muted',
                children: ['Entrega em ', r.etaMin, '–', r.etaMax, ' min'],
              })
            : null,
        ],
      }),
      s.jsxs('div', {
        className: 'v-order-grid',
        children: [
          s.jsx('div', { 'data-part': 'timeline', children: n }),
          s.jsxs('dl', {
            className: 'v-order-facts',
            'data-part': 'facts',
            children: [
              s.jsxs('div', {
                children: [
                  s.jsx('dt', { children: r.mode === 'delivery' ? 'Entrega' : 'Retirada' }),
                  s.jsx('dd', {
                    children:
                      r.mode === 'delivery' ? (r.neighborhood ?? 'Endereço informado') : 'Na loja',
                  }),
                ],
              }),
              s.jsxs('div', {
                children: [
                  s.jsx('dt', { children: 'Pagamento' }),
                  s.jsx('dd', { children: sf[e.payment.method] ?? e.payment.method }),
                ],
              }),
              s.jsxs('div', {
                children: [
                  s.jsx('dt', { children: 'Total' }),
                  s.jsx('dd', { className: 'v-num', children: le(e.totalCents, t) }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
const $v = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
function Av({ hours: e }) {
  const t = $v.map((n, r) => ({
    label: n,
    windows: e.windows.filter((l) => l.days.includes(r)).map((l) => `${l.open}–${l.close}`),
  }));
  return s.jsxs('table', {
    className: 'v-hours',
    'data-vendua': 'hours-table',
    'data-part': 'root',
    children: [
      s.jsx('caption', { className: 'v-sr', children: 'Horário de funcionamento' }),
      s.jsx('tbody', {
        children: t.map((n) =>
          s.jsxs(
            'tr',
            {
              'data-part': 'row',
              children: [
                s.jsx('th', { scope: 'row', children: n.label }),
                s.jsx('td', {
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
function Uv({ product: e, currency: t, link: n }) {
  const r = e.status !== 'active',
    [l, o] = g.useState(!1);
  return s.jsx('article', {
    className: 'v-card',
    'data-part': 'root',
    'data-status': e.status,
    children: n(
      s.jsxs(s.Fragment, {
        children: [
          s.jsx('div', {
            className: 'v-card-media',
            'data-part': 'media',
            'aria-hidden': 'true',
            children:
              e.imageUrl && !l
                ? s.jsx('img', {
                    src: e.imageUrl,
                    alt: '',
                    loading: 'lazy',
                    decoding: 'async',
                    onError: () => o(!0),
                  })
                : s.jsx('span', {
                    className: 'v-card-initial',
                    'data-figure': e.figureVariant,
                    children: e.name.slice(0, 1).toUpperCase(),
                  }),
          }),
          s.jsx('h3', { className: 'v-card-name', 'data-part': 'name', children: e.name }),
          e.description
            ? s.jsx('p', {
                className: 'v-card-desc v-muted',
                'data-part': 'description',
                children: e.description,
              })
            : null,
          s.jsx('p', {
            className: 'v-card-price v-num',
            'data-part': 'price',
            children: r
              ? s.jsx('span', { className: 'v-flag', children: 'Esgotado' })
              : le(e.basePriceCents, t),
          }),
        ],
      }),
    ),
  });
}
function Bv({ groups: e, value: t, onChange: n, currency: r, errors: l }) {
  return s.jsx('div', {
    className: 'v-mods',
    'data-vendua': 'modifier-picker',
    'data-part': 'root',
    children: e.map((o) => {
      const a = o.maxSelect === 1,
        i = t[o.id] ?? [],
        u = o.required
          ? a
            ? 'obrigatório'
            : `escolha ${Math.max(1, o.minSelect)}–${o.maxSelect}`
          : a
            ? 'opcional'
            : `até ${o.maxSelect}`;
      return s.jsxs(
        'fieldset',
        {
          className: 'v-mod-group',
          'data-part': 'group',
          'data-invalid': l[o.id] ? !0 : void 0,
          children: [
            s.jsxs('legend', {
              className: 'v-legend',
              children: [
                o.name,
                ' ',
                s.jsxs('span', { className: 'v-muted', children: ['— ', u] }),
              ],
            }),
            s.jsx('ul', {
              className: 'v-mod-list',
              role: a ? 'radiogroup' : 'group',
              'aria-label': o.name,
              children: o.modifiers.map((c) => {
                const m = i.includes(c.id),
                  d = c.status !== 'active',
                  f = !m && !a && i.length >= o.maxSelect;
                return s.jsx(
                  'li',
                  {
                    children: s.jsxs('button', {
                      type: 'button',
                      role: a ? 'radio' : 'checkbox',
                      'aria-checked': m,
                      disabled: d || f,
                      className: 'v-mod',
                      'data-part': 'modifier',
                      'data-selected': m || void 0,
                      onClick: () =>
                        n(o.id, m ? i.filter((y) => y !== c.id) : a ? [c.id] : [...i, c.id]),
                      children: [
                        s.jsx('span', { children: c.name }),
                        d ? s.jsx('span', { className: 'v-muted', children: ' · esgotado' }) : null,
                        c.priceDeltaCents !== 0
                          ? s.jsxs('span', {
                              className: 'v-muted v-num',
                              children: [
                                ' ',
                                c.priceDeltaCents > 0 ? '+' : '−',
                                le(Math.abs(c.priceDeltaCents), r),
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
            l[o.id]
              ? s.jsx('p', { className: 'v-field-error', role: 'alert', children: l[o.id] })
              : null,
          ],
        },
        o.id,
      );
    }),
  });
}
const Vv = new Set(['info', 'warning', 'blocking']);
function Fr(e) {
  if (e.kind === 'emergency') return 'blocking';
  const t = String(e.severity);
  return Vv.has(t) ? t : 'info';
}
function Wv(e) {
  return (e.actions ?? []).slice(0, 2).flatMap((t) => {
    const n = t.href;
    return typeof n == 'string' && typeof t.label == 'string'
      ? [{ label: t.label, href: n, action: t }]
      : [];
  });
}
function Hv({ onDismiss: e }) {
  return s.jsx('button', {
    type: 'button',
    className: 'v-notice-dismiss',
    'data-part': 'dismiss',
    'aria-label': 'Dispensar aviso',
    onClick: e,
    children: '×',
  });
}
function Qr({ notice: e, onDismiss: t, onAction: n, extra: r }) {
  const l = Fr(e),
    o = Wv(e);
  return s.jsxs('div', {
    className: `v-notice v-notice-${l}`,
    'data-vendua': 'notice',
    'data-part': 'root',
    'data-kind': e.kind,
    'data-severity': l,
    role: l === 'blocking' ? 'alertdialog' : 'status',
    'aria-modal': l === 'blocking' || void 0,
    'aria-labelledby': `vn-${e.id}`,
    children: [
      s.jsx('strong', {
        className: 'v-notice-title',
        'data-part': 'title',
        id: `vn-${e.id}`,
        children: e.title || 'Aviso',
      }),
      e.body
        ? s.jsx('p', { className: 'v-notice-body', 'data-part': 'body', children: e.body })
        : null,
      r,
      o.length > 0
        ? s.jsx('p', {
            className: 'v-notice-actions',
            'data-part': 'actions',
            children: o.map((a, i) =>
              s.jsx(
                'a',
                {
                  className: 'v-notice-action',
                  href: a.href,
                  onClick: () => (n == null ? void 0 : n(a.action)),
                  children: a.label,
                },
                i,
              ),
            ),
          })
        : null,
      e.dismissible && t && l !== 'blocking' ? s.jsx(Hv, { onDismiss: t }) : null,
    ],
  });
}
function Qv({ notice: e, resumesAt: t, onNotifyMe: n, onDismiss: r }) {
  return s.jsx(Qr, {
    notice: e,
    ...(r ? { onDismiss: r } : {}),
    extra: s.jsxs(s.Fragment, {
      children: [
        t
          ? s.jsxs('p', {
              className: 'v-notice-meta',
              'data-part': 'resumes',
              children: ['Volta ', bi(t)],
            })
          : null,
        n
          ? s.jsx('button', {
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
function Kv({ notice: e, opensAt: t, onDismiss: n }) {
  return s.jsx(Qr, {
    notice: e,
    ...(n ? { onDismiss: n } : {}),
    extra:
      t && !e.body
        ? s.jsxs('p', {
            className: 'v-notice-meta',
            'data-part': 'opens',
            children: ['Abrimos ', bi(t)],
          })
        : null,
  });
}
function bv(e) {
  return s.jsx(Qr, { ...e });
}
function Yv({ notice: e }) {
  return s.jsx(Qr, { notice: { ...e, severity: 'blocking', dismissible: !1 } });
}
function Gv({ purposes: e, onAccept: t, onReject: n }) {
  return s.jsxs('section', {
    className: 'v-consent',
    'data-vendua': 'consent',
    'data-part': 'root',
    'aria-label': 'Privacidade',
    children: [
      s.jsxs('p', {
        className: 'v-consent-text',
        'data-part': 'text',
        children: [
          'Usamos dados de navegação para ',
          e.map((r) => r.label.toLowerCase()).join(' e '),
          '. Você escolhe.',
        ],
      }),
      s.jsxs('div', {
        className: 'v-consent-actions',
        'data-part': 'actions',
        children: [
          s.jsx('button', {
            type: 'button',
            className: 'v-btn v-btn-ghost',
            onClick: n,
            children: 'Só o essencial',
          }),
          s.jsx('button', {
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
function Xv({ error: e, retry: t }) {
  return s.jsxs('div', {
    className: 'v-panel v-error',
    'data-vendua': 'error-fallback',
    'data-part': 'root',
    role: 'alert',
    children: [
      s.jsx('h2', {
        className: 'v-panel-title',
        'data-part': 'title',
        children: 'Algo não carregou',
      }),
      s.jsx('p', {
        className: 'v-muted',
        'data-part': 'body',
        children: e.message || 'Tente de novo em instantes.',
      }),
      s.jsx('button', {
        type: 'button',
        className: 'v-btn v-btn-accent',
        'data-part': 'retry',
        onClick: t,
        children: 'Tentar novamente',
      }),
    ],
  });
}
function Jv({ path: e, homeHref: t }) {
  return s.jsxs('main', {
    id: 'main',
    className: 'v-page v-not-found',
    'data-vendua-page': 'not-found',
    'data-part': 'root',
    children: [
      s.jsx('h1', {
        className: 'v-page-title',
        'data-part': 'title',
        children: 'Página não encontrada',
      }),
      s.jsxs('p', {
        className: 'v-muted',
        'data-part': 'body',
        children: ['O endereço ', s.jsx('code', { children: e }), ' não existe nesta loja.'],
      }),
      s.jsx('a', {
        className: 'v-btn v-btn-accent',
        href: t,
        'data-part': 'home',
        children: 'Voltar para o início',
      }),
    ],
  });
}
const Zv = {
  'system.Notice': Qr,
  'system.PauseNotice': Qv,
  'system.StoreClosedNotice': Kv,
  'system.PromoNotice': bv,
  'system.ConsentBanner': Gv,
  'system.ErrorFallback': Xv,
  'system.NotFound': Jv,
  'system.EmergencyOverlay': Yv,
  'checkout.Layout': Cv,
  'checkout.Summary': _v,
  'checkout.AddressForm': Pv,
  'checkout.DeliveryOptions': Tv,
  'checkout.PaymentMethods': Ov,
  'checkout.SuccessPage': Lv,
  'checkout.EmptyCart': Rv,
  'cart.Drawer': zv,
  'cart.LineItem': Iv,
  'order.StatusPage': Fv,
  'order.Timeline': Mv,
  'store.HoursTable': Av,
  'catalog.ProductCard': Uv,
  'catalog.ModifierPicker': Bv,
};
class Yi extends g.Component {
  constructor() {
    super(...arguments);
    dn(this, 'state', { failed: !1, key: this.props.resetKey });
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
const Su = new WeakMap();
function qv(e) {
  let t = Su.get(e);
  return (t || Su.set(e, (t = g.lazy(e))), t);
}
function eg(e) {
  const { config: t } = G(),
    n = g.useMemo(() => {
      var l, o;
      const r = (l = t.overrides) == null ? void 0 : l[e];
      if (r) return r;
      for (const [a, i] of Object.entries(lv))
        if (i.to === e && (o = t.overrides) != null && o[a]) return t.overrides[a];
    }, [t, e]);
  return n ? qv(n) : null;
}
function F({ name: e, ...t }) {
  const n = Zv[e],
    r = eg(e),
    l = t,
    o = s.jsx(n, { ...l });
  return r
    ? s.jsx(Yi, {
        fallback: o,
        onError: (a) =>
          vo({
            kind: 'slot_error',
            target: e,
            message: a instanceof Error ? a.message : String(a),
          }),
        children: s.jsx(g.Suspense, { fallback: o, children: s.jsx(r, { ...l }) }),
      })
    : o;
}
function ye() {
  var n, r;
  const { api: e } = G(),
    t = gt('store', () => e.store());
  return {
    store: t.data,
    status: (n = t.data) == null ? void 0 : n.status,
    resumesAt: (r = t.data) == null ? void 0 : r.resumesAt,
    loading: t.loading,
    error: t.error,
    refetch: t.refetch,
  };
}
function uf() {
  var n;
  const { api: e } = G(),
    t = gt('catalog', () => e.catalog());
  return {
    categories: ((n = t.data) == null ? void 0 : n.categories) ?? [],
    loading: t.loading,
    error: t.error,
    refetch: t.refetch,
  };
}
function cf(e) {
  var o;
  const { api: t } = G(),
    n = gt(`product:${e}`, () => t.product(e)),
    r = (o = n.data) == null ? void 0 : o.product,
    l = g.useRef(null);
  return (
    g.useEffect(() => {
      !r ||
        l.current === r.id ||
        ((l.current = r.id), Ue('product_view', { product_id: r.id, slug: r.slug }));
    }, [r]),
    { product: r, loading: n.loading, error: n.error, refetch: n.refetch }
  );
}
function tg() {
  var n;
  const { api: e } = G(),
    t = gt('zones', () => e.zones());
  return {
    zones: ((n = t.data) == null ? void 0 : n.zones) ?? [],
    loading: t.loading,
    error: t.error,
    refetch: t.refetch,
  };
}
function Bt() {
  const { api: e, invalidate: t } = G(),
    n = gt('cart', () => (e.sessionToken ? e.cart().then((o) => o.cart) : Promise.resolve(null))),
    r = g.useCallback((o) => (Ki('cart', o), t('cart'), o), [t]),
    l = g.useMemo(
      () => ({
        add: (o, a = 1, i = []) => e.addItem(o, a, i).then(r),
        updateQty: (o, a) => e.updateItem(o, a).then(r),
        remove: (o) => e.removeItem(o).then(r),
        setDelivery: (o) => e.setDelivery(o).then(r),
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
function ng(e) {
  const { api: t } = G(),
    n = gt(`order:${e}`, () => t.order(e));
  return { order: n.data, loading: n.loading, error: n.error, refetch: n.refetch };
}
function rg() {
  const { api: e, invalidate: t } = G(),
    [n, r] = g.useState(!1),
    [l, o] = g.useState();
  return {
    submit: g.useCallback(
      async (i) => {
        (r(!0), o(void 0), Ue('payment_submit', { method: i.payment.method }));
        try {
          const u = await e.checkout(i);
          return (Ki('cart'), t('cart'), u);
        } catch (u) {
          const c =
            u instanceof Mr
              ? { status: u.status, code: u.code, message: u.message, details: u.details }
              : { code: 'INTERNAL', message: u instanceof Error ? u.message : 'checkout failed' };
          throw (o(c), Ue('order_failed', { code: c.code }), u);
        } finally {
          r(!1);
        }
      },
      [e, t],
    ),
    pending: n,
    error: l,
    reset: g.useCallback(() => o(void 0), []),
  };
}
const Ya = 'vendua.customer';
let Qt;
const dl = new Set();
function lg() {
  var e;
  if (Qt !== void 0) return Qt;
  try {
    const t = (e = globalThis.localStorage) == null ? void 0 : e.getItem(Ya),
      n = t ? JSON.parse(t) : null;
    Qt = n && typeof n.name == 'string' && typeof n.phone == 'string' ? n : null;
  } catch {
    Qt = null;
  }
  return Qt;
}
function og() {
  const e = g.useSyncExternalStore(
      (r) => (dl.add(r), () => dl.delete(r)),
      lg,
      () => null,
    ),
    t = g.useCallback((r) => {
      var o;
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
      Qt = l;
      try {
        (o = globalThis.localStorage) == null || o.setItem(Ya, JSON.stringify(l));
      } catch {}
      dl.forEach((a) => a());
    }, []),
    n = g.useCallback(() => {
      var r;
      Qt = null;
      try {
        (r = globalThis.localStorage) == null || r.removeItem(Ya);
      } catch {}
      dl.forEach((l) => l());
    }, []);
  return { customer: e, status: e ? 'remembered' : 'guest', remember: t, forget: n };
}
function ag() {
  return { consent: g.useSyncExternalStore(xv, kv, () => null), decide: yv };
}
function ig() {
  const { api: e } = G(),
    t = e.orderIds().slice(0, 20),
    n = gt(`orders:${t.join(',')}`, async () =>
      (await Promise.allSettled(t.map((l) => e.order(l)))).flatMap((l) =>
        l.status === 'fulfilled' ? [l.value] : [],
      ),
    );
  return { orders: n.data ?? [], loading: n.loading, refetch: n.refetch };
}
const wu = new Set();
function Gi({ notice: e, onDismiss: t }) {
  var o;
  g.useEffect(() => {
    wu.has(e.id) || (wu.add(e.id), Ue('notice_shown', { kind: e.kind, severity: Fr(e) }));
  }, [e]);
  const n = (a) => Ue('notice_action', { kind: e.kind, severity: Fr(e), action: a.type }),
    r = t ? { onDismiss: t } : {},
    l =
      typeof ((o = e.payload) == null ? void 0 : o.resumesAt) == 'string'
        ? e.payload.resumesAt
        : void 0;
  switch (e.kind) {
    case 'store_paused':
      return s.jsx(F, {
        name: 'system.PauseNotice',
        notice: e,
        actions: e.actions ?? [],
        ...(l ? { resumesAt: l } : {}),
        ...r,
      });
    case 'store_closed':
      return s.jsx(F, {
        name: 'system.StoreClosedNotice',
        notice: e,
        ...(l ? { opensAt: l } : {}),
        ...r,
      });
    case 'promo':
    case 'promo_notice':
      return s.jsx(F, { name: 'system.PromoNotice', notice: e, ...r });
    case 'emergency':
      return s.jsx(F, { name: 'system.EmergencyOverlay', notice: e });
    default:
      return s.jsx(F, { name: 'system.Notice', notice: e, onAction: n, ...r });
  }
}
function sg({ notice: e }) {
  const [t, n] = g.useState(!1);
  return t ? null : s.jsx(Gi, { notice: e, onDismiss: () => n(!0) });
}
const ug = { analytics: 'Métricas de uso', marketing: 'Ofertas personalizadas' };
function cg() {
  var l;
  const { config: e } = G(),
    { consent: t, decide: n } = ag(),
    r = ((l = e.consent) == null ? void 0 : l.purposes) ?? [];
  return r.length === 0 || t
    ? null
    : s.jsx(F, {
        name: 'system.ConsentBanner',
        purposes: r.map((o) => ({ id: o, label: ug[o] })),
        onAccept: (o) => n(o),
        onReject: () => n([]),
      });
}
function dg({ notices: e }) {
  const t = g.useRef(null);
  return (
    g.useEffect(() => {
      var n, r, l, o;
      ((r = (n = t.current) == null ? void 0 : n.querySelector('[role="alertdialog"]')) == null ||
        r.setAttribute('tabindex', '-1'),
        (o = (l = t.current) == null ? void 0 : l.querySelector('[role="alertdialog"]')) == null ||
          o.focus({ preventScroll: !0 }));
    }, [e.length]),
    s.jsx('div', {
      className: 'v-blocking-overlay',
      'data-vendua': 'blocking-overlay',
      ref: t,
      children: e.map((n) => s.jsx(Gi, { notice: n }, n.id)),
    })
  );
}
function fg({ zoneMatched: e } = {}) {
  const { api: t } = G(),
    n = globalThis.__VENDUA_STATE__,
    r = `surfaces:${e === void 0 ? 'any' : e}`,
    o = gt(r, () => t.surfaces(e)).data ?? (e === void 0 ? n : void 0),
    a = fv(),
    [, i] = g.useState(0);
  g.useEffect(() => {
    if (!o) return;
    const f = Date.now();
    let y = 1 / 0;
    for (const x of o.notices)
      for (const E of [x.startsAt, x.endsAt]) {
        if (!E) continue;
        const h = Date.parse(E);
        h > f && h < y && (y = h);
      }
    if (y === 1 / 0) return;
    const S = setTimeout(() => i((x) => x + 1), Math.min(y - f + 50, 2 ** 31 - 1));
    return () => clearTimeout(S);
  }, [o]);
  const u = Date.now(),
    c = ((o == null ? void 0 : o.notices) ?? []).filter(
      (f) =>
        (!f.startsAt || Date.parse(f.startsAt) <= u) && (!f.endsAt || Date.parse(f.endsAt) > u),
    ),
    m = c.filter((f) => Fr(f) === 'blocking'),
    d = c.filter((f) => Fr(f) !== 'blocking');
  return s.jsxs(s.Fragment, {
    children: [
      s.jsxs('div', {
        className: 'v-banner-stack',
        'data-vendua': 'banner-stack',
        'aria-live': 'polite',
        children: [
          d.map((f) => s.jsx(sg, { notice: f }, f.id)),
          a.map((f) => s.jsx(Gi, { notice: f, onDismiss: () => nf(f.id) }, f.id)),
        ],
      }),
      m.length > 0 ? s.jsx(dg, { notices: m }) : null,
      s.jsx(cg, {}),
    ],
  });
}
const df = 'sdk:page-content';
function pg(e) {
  return e.startsWith('page:') ? e.slice(5) : null;
}
const mg = {
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
function hg(e) {
  if (!e || typeof e != 'object') return !1;
  const t = e;
  return (
    typeof t.default == 'function' &&
    !!t.schema &&
    (t.schema.kind === 'section' || t.schema.kind === 'block')
  );
}
function vg(e, t) {
  const n = new Map();
  for (const r of e) n.set(r.schema.type, r);
  for (const [r, l] of Object.entries(t)) {
    if (!hg(l)) {
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
const $ = (e) => ({ kind: 'text', ...e }),
  gg = (e) => ({ kind: 'richText', ...e }),
  ff = (e) => ({ kind: 'number', ...e }),
  mt = (e = {}) => ({ kind: 'boolean', ...e }),
  Ft = (e, t) => ({ kind: 'select', options: e, ...t }),
  $r = (e = {}) => ({ kind: 'url', ...e }),
  yg = (e = {}) => ({ kind: 'product', ...e }),
  xg = (e = {}) => ({ kind: 'category', ...e }),
  pf = (e, t) => ({ kind: 'list', of: e, ...t });
function Ye(e) {
  return { kind: 'section', ...e };
}
function Xi(e) {
  return { kind: 'block', ...e };
}
const kg = /^[a-z0-9][a-z0-9-]{0,99}$/,
  Sg = /^(\/(?!\/)|https:\/\/|#|mailto:|tel:|https:\/\/wa\.me\/)/;
function wg(e, t) {
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
      return typeof t == 'string' && t.length <= 500 && Sg.test(t) ? t : e.default;
    case 'product':
    case 'category':
      return typeof t == 'string' && kg.test(t) ? t : e.default;
    case 'list':
      return Array.isArray(t)
        ? t
            .slice(0, e.max)
            .filter((n) => n && typeof n == 'object' && !Array.isArray(n))
            .map((n) => Ji(e.of, n))
        : e.default;
  }
}
function Ji(e, t) {
  const n = {};
  for (const [r, l] of Object.entries(e)) {
    const o = wg(l, t == null ? void 0 : t[r]);
    o !== void 0 && (n[r] = o);
  }
  return n;
}
const mf = g.createContext(null),
  hf = g.createContext({ page: 'home', params: {} }),
  Zi = g.createContext(null);
function yo() {
  return g.useContext(hf);
}
function vf({ value: e, children: t }) {
  return s.jsx(hf.Provider, { value: e, children: t });
}
function xo() {
  return g.useContext(mf) ?? Eg;
}
const Eg = new Map();
function jg({ sdk: e, children: t }) {
  const { storefront: n } = G(),
    r = g.useMemo(() => vg(e, n.sections), [e, n]);
  return s.jsx(mf.Provider, { value: r, children: t });
}
const Eu = new Set();
function Ng(e, t, n) {
  Eu.has(`${e}:${t}`) || (Eu.add(`${e}:${t}`), vo({ kind: e, target: t, message: n }));
}
function gf() {
  const { api: e, storefront: t } = G(),
    n = gt('state:templates', () => e.state(!0));
  return g.useMemo(() => {
    var r;
    return {
      ...mg,
      ...t.snapshot.templates,
      ...(((r = n.data) == null ? void 0 : r.templates) ?? {}),
    };
  }, [t, n.data]);
}
function yf(e) {
  return gf()[e];
}
function xf({ kind: e, type: t }) {
  return (
    g.useEffect(() => {
      Ng(
        e,
        t,
        `no ${e === 'section_unknown' ? 'section' : 'block'} registered for '${t}' in this build`,
      );
    }, [e, t]),
    null
  );
}
function Cg({ instance: e }) {
  const n = xo().get(e.type);
  if (!n || n.schema.kind !== 'section')
    return s.jsx(xf, { kind: 'section_unknown', type: e.type });
  const r = Ji(n.schema.settings, e.settings),
    { Component: l } = n;
  return s.jsx(Yi, {
    fallback: null,
    resetKey: e,
    onError: (o) =>
      vo({
        kind: 'section_error',
        target: `${e.type}#${e.id}`,
        message: o instanceof Error ? o.message : String(o),
      }),
    children: s.jsx(Zi.Provider, {
      value: { instance: e, schema: n.schema },
      children: s.jsx('div', {
        'data-section': e.type,
        'data-section-id': e.id,
        style: { display: 'contents' },
        children: s.jsx(l, { settings: r, id: e.id }),
      }),
    }),
  });
}
function _g({ instance: e }) {
  const n = xo().get(e.type);
  if (!n || n.schema.kind !== 'block') return s.jsx(xf, { kind: 'block_unknown', type: e.type });
  const r = Ji(n.schema.settings, e.settings),
    { Component: l } = n;
  return s.jsx(Yi, {
    fallback: null,
    resetKey: e,
    onError: (o) =>
      vo({
        kind: 'section_error',
        target: `${e.type}#${e.id}`,
        message: o instanceof Error ? o.message : String(o),
      }),
    children: s.jsx('div', {
      'data-block': e.type,
      'data-block-id': e.id,
      style: { display: 'contents' },
      children: s.jsx(l, { settings: r, id: e.id }),
    }),
  });
}
function Pg(e, t) {
  var l;
  const n = g.useContext(Zi),
    r = xo();
  return (((l = n == null ? void 0 : n.instance.blocks) == null ? void 0 : l[e]) ?? []).some(
    (o) => {
      const a = r.get(o.type);
      return (a == null ? void 0 : a.schema.kind) === 'block' && a.schema.category === t;
    },
  );
}
function Gt({ name: e, className: t, only: n }) {
  var u, c;
  const r = g.useContext(Zi),
    l = xo();
  if (!r) return null;
  const o = (u = r.schema.areas) == null ? void 0 : u[e],
    a = ((c = r.instance.blocks) == null ? void 0 : c[e]) ?? [];
  if (!o || a.length === 0) return null;
  const i = a
    .filter((m) => {
      const d = l.get(m.type);
      return d
        ? d.schema.kind === 'block' &&
            o.accepts.includes(d.schema.category) &&
            (!n || n.includes(d.schema.category))
        : !n;
    })
    .slice(0, o.max ?? 1 / 0);
  return i.length === 0
    ? null
    : s.jsx('div', {
        className: t,
        'data-area': e,
        children: i.map((m) => s.jsx(_g, { instance: m }, m.id)),
      });
}
function kf({ template: e, only: t }) {
  return s.jsx(s.Fragment, {
    children: e.sections
      .filter((n) => (!n.disabled || n.type === df) && (t ? t(n) : !0))
      .map((n) => s.jsx(Cg, { instance: n }, n.id)),
  });
}
function Kr(e, t, n, r = 'button') {
  if (e && g.isValidElement(n)) {
    const l = n,
      o = l.props,
      a = { ...t, ...o };
    return (
      t['data-vendua'] && (a['data-vendua'] = t['data-vendua']),
      (typeof t.onClick == 'function' || typeof o.onClick == 'function') &&
        (a.onClick = (i) => {
          var u, c;
          ((u = t.onClick) == null || u.call(t, i), (c = o.onClick) == null || c.call(o, i));
        }),
      (t.className || o.className) &&
        (a.className = [t.className, o.className].filter(Boolean).join(' ')),
      (t.disabled || o.disabled) && (a.disabled = !0),
      g.cloneElement(l, a)
    );
  }
  return r === 'a'
    ? s.jsx('a', { ...t, children: n })
    : s.jsx('button', { type: 'button', ...t, children: n });
}
function sn() {
  const e = g.useContext(Hn);
  return (t) => {
    var n;
    e != null && e.navigator
      ? e.navigator.push(t)
      : (n = globalThis.location) == null || n.assign(t);
  };
}
const Tg = (e) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
function Og({ product: e, asChild: t, children: n, className: r, prefetch: l = !0 }) {
  const { config: o, api: a } = G(),
    i = sn(),
    u = Zd(o, e.slug),
    c = () => {
      l && Nv(a, `product:${e.slug}`, () => a.product(e.slug));
    };
  return Kr(
    t,
    {
      'data-vendua': 'product-link',
      href: u,
      ...(r ? { className: r } : {}),
      onMouseEnter: c,
      onFocus: c,
      onTouchStart: c,
      onClick: (m) => {
        Tg(m) && (m.preventDefault(), i(u));
      },
    },
    n ?? e.name ?? e.slug,
    'a',
  );
}
function Lg({
  product: e,
  qty: t = 1,
  modifierIds: n = [],
  asChild: r,
  children: l,
  onAdded: o,
  onError: a,
}) {
  const { status: i } = ye(),
    { mutations: u } = Bt(),
    [c, m] = g.useState(!1),
    d = e.status !== 'active',
    f = c || d || i === 'paused';
  return Kr(
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
              Ue('add_to_cart', {
                product_id: e.id,
                qty: t,
                modifiers: n.length,
                ...(e.basePriceCents !== void 0 ? { value: e.basePriceCents * t } : {}),
              }),
              o == null || o());
          } catch (S) {
            a ? a(S) : ho(S);
          } finally {
            m(!1);
          }
        }
      },
    },
    l ?? (d ? 'Esgotado' : 'Adicionar'),
  );
}
function Sf({ asChild: e, children: t, onOpen: n }) {
  const { cart: r } = Bt(),
    l = sn(),
    o = (r == null ? void 0 : r.status) === 'open' ? r.totals.itemCount : 0;
  return Kr(
    e,
    {
      'data-vendua': 'cart-trigger',
      'data-count': o,
      'aria-label': `sacola, ${o} ${o === 1 ? 'item' : 'itens'}`,
      onClick: (a) => {
        if (
          (Ue('cart_open', {
            item_count: o,
            cart_value: (r == null ? void 0 : r.totals.totalCents) ?? 0,
          }),
          n)
        )
          return n();
        (a && 'preventDefault' in a && a.preventDefault(), l(qe.cart));
      },
    },
    t ?? s.jsxs(s.Fragment, { children: ['Sacola (', o, ')'] }),
  );
}
function Rg({ asChild: e, children: t, onStart: n, className: r }) {
  const { api: l } = G(),
    { status: o } = ye(),
    { cart: a } = Bt(),
    i = sn(),
    [u, c] = g.useState(!1),
    d =
      !a || a.status !== 'open' || a.items.length === 0 || o === 'paused' || a.totals.belowMinOrder,
    f = u || d;
  return Kr(
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
              Ue('checkout_start', { cart_value: (a == null ? void 0 : a.totals.totalCents) ?? 0 }),
              n ? n() : i(qe.checkout));
          } catch (y) {
            ho(y);
          } finally {
            c(!1);
          }
        }
      },
    },
    t ?? 'Ir para o pagamento',
  );
}
function Dg({
  subject: e,
  productId: t,
  phone: n,
  asChild: r,
  children: l,
  onSubscribed: o,
  onError: a,
}) {
  const { api: i } = G(),
    [u, c] = g.useState('idle'),
    m = n.replace(/\D/g, ''),
    d = m.length >= 10 && m.length <= 13 && (e === 'store' || !!t),
    f = u !== 'idle' || !d;
  return Kr(
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
            (await i.notifyMe({ subject: e, phone: m, ...(t ? { productId: t } : {}) }),
              Ue('notify_me', { subject: e, ...(t ? { product_id: t } : {}) }),
              c('done'),
              o == null || o());
          } catch (y) {
            (c('idle'), a ? a(y) : ho(y));
          }
        }
      },
    },
    l ?? (u === 'done' ? 'Pronto, vamos avisar' : 'Avise-me'),
  );
}
function wf() {
  const { status: e, resumesAt: t, store: n } = ye(),
    r = e === 'open' ? 'Aberto' : e === 'paused' ? 'Pausado' : 'Fechado',
    l = t
      ? new Intl.DateTimeFormat('pt-BR', {
          timeZone: n == null ? void 0 : n.hours.timezone,
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(t))
      : void 0;
  return s.jsx('span', {
    'data-vendua': 'store-status',
    'data-status': e ?? 'loading',
    role: 'status',
    'aria-live': 'polite',
    title: l ? `retorna ${l}` : n == null ? void 0 : n.name,
    children: e ? r : '…',
  });
}
function Ef() {
  const { params: e } = yo();
  return cf(e.slug ?? '').product;
}
function zg({ settings: e }) {
  const t = Ef();
  if (!t) return null;
  if (t.status === 'sold_out')
    return s.jsx('p', {
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
    : s.jsx('p', {
        className: 'v-stock',
        'data-part': 'root',
        'data-tone': r ? 'low' : 'ok',
        role: 'status',
        children: r
          ? `Restam ${n} ${n === 1 ? 'unidade' : 'unidades'}`
          : `${n} unidades disponíveis`,
      });
}
function Ig({ settings: e }) {
  const t = Ef(),
    { status: n } = ye(),
    [r, l] = g.useState(''),
    [o, a] = g.useState(!1),
    i =
      (t == null ? void 0 : t.status) === 'sold_out' ? 'product' : n === 'paused' ? 'store' : null;
  return i
    ? o
      ? s.jsx('p', {
          className: 'v-note',
          role: 'status',
          'data-part': 'done',
          children: e.successText,
        })
      : s.jsxs('div', {
          className: 'v-notify',
          'data-part': 'root',
          children: [
            s.jsx('label', { className: 'v-label', htmlFor: 'v-notify-phone', children: e.title }),
            s.jsxs('div', {
              className: 'v-notify-row',
              children: [
                s.jsx('input', {
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
                s.jsx(Dg, {
                  subject: i,
                  ...(i === 'product' && t ? { productId: t.id } : {}),
                  phone: r,
                  onSubscribed: () => a(!0),
                  asChild: !0,
                  children: s.jsx('button', {
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
function Mg({ settings: e }) {
  return e.text
    ? s.jsx('span', {
        className: 'v-badge',
        'data-part': 'root',
        'data-tone': e.tone,
        children: e.text,
      })
    : null;
}
const Fg = Ye({ type: 'sdk:page-content', settings: {} }),
  $g = Ye({
    type: 'sdk:header',
    settings: {
      brand: $({ max: 60 }),
      logo: $r(),
      links: pf({ label: $({ max: 40, default: '' }), href: $r({ default: '/' }) }, { max: 6 }),
      showStatus: mt({ default: !0 }),
      cartLabel: $({ max: 30, default: 'Sacola' }),
    },
    areas: { actions: { accepts: ['badge', 'info'], max: 2 } },
  }),
  Ag = Ye({
    type: 'sdk:footer',
    settings: {
      note: $({ max: 160 }),
      showHours: mt({ default: !0 }),
      showContacts: mt({ default: !0 }),
      links: pf({ label: $({ max: 40, default: '' }), href: $r({ default: '/' }) }, { max: 8 }),
    },
    areas: { extra: { accepts: ['info', 'social-proof', 'promo'], max: 3 } },
  }),
  Ug = Ye({
    type: 'sdk:announcement-bar',
    settings: {
      text: $({ max: 140, default: '' }),
      href: $r(),
      linkLabel: $({ max: 40 }),
      tone: Ft(['accent', 'surface'], { default: 'accent' }),
    },
  }),
  Bg = Ye({
    type: 'sdk:header-cart',
    settings: {
      label: $({ max: 30, default: 'Sacola' }),
      variant: Ft(['pill', 'text'], { default: 'pill' }),
    },
  }),
  Vg = Ye({
    type: 'sdk:purchase-panel',
    settings: {
      variant: Ft(['split', 'compact', 'editorial'], { default: 'split' }),
      product: yg(),
      showDescription: mt({ default: !0 }),
      addLabel: $({ max: 40, default: 'Adicionar à sacola' }),
      backLabel: $({ max: 40, default: 'Voltar ao cardápio' }),
      soldOutText: $({ max: 80, default: 'Esgotado no momento.' }),
      afterAdd: Ft(['cart', 'stay'], { default: 'cart' }),
    },
    areas: {
      media: { accepts: ['media', 'badge'], max: 3 },
      'after-price': { accepts: ['purchase-extras', 'badge', 'promo', 'info'], max: 4 },
      'after-cta': { accepts: ['purchase-extras', 'info', 'social-proof'], max: 4 },
    },
  }),
  Wg = Ye({
    type: 'sdk:catalog-grid',
    settings: {
      eyebrow: $({ max: 60 }),
      title: $({ max: 80 }),
      intro: $({ max: 240 }),
      variant: Ft(['grid', 'list'], { default: 'grid' }),
      showSearch: mt({ default: !1 }),
      searchLabel: $({ max: 60, default: 'Buscar no cardápio' }),
      showCategoryTabs: mt({ default: !0 }),
      allLabel: $({ max: 40, default: 'Tudo' }),
      emptyText: $({ max: 160, default: 'O cardápio ainda está vazio.' }),
    },
    areas: { 'before-grid': { accepts: ['promo', 'info'], max: 2 } },
  }),
  Hg = Ye({
    type: 'sdk:product-list',
    settings: {
      eyebrow: $({ max: 60 }),
      title: $({ max: 80 }),
      intro: $({ max: 240 }),
      category: xg(),
      limit: ff({ min: 1, max: 12, default: 4 }),
      variant: Ft(['grid', 'list'], { default: 'grid' }),
      ctaLabel: $({ max: 40 }),
      ctaHref: $r(),
    },
  }),
  Qg = Ye({
    type: 'sdk:store-status',
    settings: {
      title: $({ max: 80, default: 'Horários' }),
      showHours: mt({ default: !0 }),
      showAddress: mt({ default: !0 }),
      variant: Ft(['card', 'inline'], { default: 'card' }),
    },
  }),
  Kg = Ye({
    type: 'sdk:rich-text',
    settings: { eyebrow: $({ max: 60 }), title: $({ max: 120 }), body: gg({ max: 4e3 }) },
  }),
  bg = Xi({
    type: 'sdk:stock-counter',
    category: 'purchase-extras',
    settings: {
      threshold: ff({ min: 1, max: 50, default: 5 }),
      showWhenPlenty: mt({ default: !1 }),
    },
  }),
  Yg = Xi({
    type: 'sdk:notify-me',
    category: 'purchase-extras',
    settings: {
      title: $({ max: 80, default: 'Esgotou? A gente te avisa quando voltar.' }),
      successText: $({ max: 120, default: 'Pronto! Você recebe uma mensagem quando voltar.' }),
    },
  }),
  Gg = Xi({
    type: 'sdk:promo-badge',
    category: 'badge',
    settings: {
      text: $({ max: 40, default: '' }),
      tone: Ft(['accent', 'surface'], { default: 'accent' }),
    },
  });
function nt({ href: e, className: t, children: n, ...r }) {
  const l = sn(),
    o = e.startsWith('/') && !e.startsWith('//');
  return s.jsx('a', {
    ...r,
    href: e,
    className: t,
    onClick: (a) => {
      !o ||
        a.button !== 0 ||
        a.metaKey ||
        a.ctrlKey ||
        a.shiftKey ||
        a.altKey ||
        (a.preventDefault(), l(e));
    },
    children: n,
  });
}
function qi({ eyebrow: e, title: t, intro: n, as: r = 'h2' }) {
  if (!e && !t && !n) return null;
  const l = r;
  return s.jsxs('header', {
    className: 'v-section-head',
    'data-part': 'head',
    children: [
      e ? s.jsx('p', { className: 'v-eyebrow', children: e }) : null,
      t
        ? s.jsx(l, { className: r === 'h1' ? 'v-page-title' : 'v-section-title', children: t })
        : null,
      n ? s.jsx('p', { className: 'v-muted', children: n }) : null,
    ],
  });
}
function Xg() {
  return s.jsx(Zh, {});
}
function Jg({ settings: e }) {
  var o;
  const { store: t } = ye(),
    { cart: n } = Bt(),
    r = (n == null ? void 0 : n.status) === 'open' ? n.totals.itemCount : 0,
    l = e.brand || (t == null ? void 0 : t.name) || 'Loja';
  return s.jsxs('header', {
    className: 'v-header',
    'data-part': 'root',
    children: [
      s.jsx('a', {
        href: '#main',
        className: 'v-sr',
        'data-part': 'skip',
        children: 'Pular para o conteúdo',
      }),
      s.jsxs('div', {
        className: 'v-header-inner',
        children: [
          s.jsxs(nt, {
            href: '/',
            className: 'v-brand',
            'data-part': 'brand',
            'aria-label': `${l} — início`,
            children: [
              e.logo
                ? s.jsx('img', { src: e.logo, alt: '', height: 36, 'data-part': 'logo' })
                : null,
              s.jsx('span', { children: l }),
            ],
          }),
          (o = e.links) != null && o.length
            ? s.jsx('nav', {
                className: 'v-nav',
                'aria-label': 'Navegação principal',
                'data-part': 'nav',
                children: e.links.map((a, i) => s.jsx(nt, { href: a.href, children: a.label }, i)),
              })
            : null,
          s.jsxs('div', {
            className: 'v-header-actions',
            'data-part': 'actions',
            children: [
              s.jsx(Gt, { name: 'actions' }),
              e.showStatus ? s.jsx(wf, {}) : null,
              s.jsx(Sf, {
                asChild: !0,
                children: s.jsxs('button', {
                  type: 'button',
                  className: 'v-cart-pill',
                  'data-part': 'cart',
                  children: [
                    e.cartLabel,
                    ' ',
                    s.jsx('span', { className: 'v-cart-count', children: r }),
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
function Zg({ settings: e }) {
  var l, o, a;
  const { store: t } = ye(),
    n = (l = t == null ? void 0 : t.whatsapp) == null ? void 0 : l.replace(/\D/g, ''),
    r = (o = t == null ? void 0 : t.instagram) == null ? void 0 : o.replace(/^@/, '');
  return s.jsx('footer', {
    className: 'v-footer',
    'data-part': 'root',
    children: s.jsxs('div', {
      className: 'v-footer-inner',
      children: [
        s.jsxs('div', {
          'data-part': 'about',
          children: [
            s.jsx('p', {
              style: { fontWeight: 600 },
              children: (t == null ? void 0 : t.name) ?? '',
            }),
            e.note ? s.jsx('p', { className: 'v-muted', children: e.note }) : null,
            t != null && t.address
              ? s.jsxs('p', {
                  className: 'v-muted',
                  children: [t.address, t.city ? `, ${t.city}` : ''],
                })
              : null,
            e.showContacts
              ? s.jsxs('p', {
                  className: 'v-footer-contacts',
                  'data-part': 'contacts',
                  children: [
                    n
                      ? s.jsx('a', {
                          href: `https://wa.me/${n}`,
                          rel: 'noopener noreferrer',
                          target: '_blank',
                          children: 'WhatsApp',
                        })
                      : null,
                    n && r ? ' · ' : null,
                    r
                      ? s.jsxs('a', {
                          href: `https://www.instagram.com/${r}/`,
                          rel: 'noopener noreferrer',
                          target: '_blank',
                          children: ['Instagram @', r],
                        })
                      : null,
                  ],
                })
              : null,
            (a = e.links) != null && a.length
              ? s.jsx('nav', {
                  'aria-label': 'Links do rodapé',
                  'data-part': 'links',
                  children: e.links.map((i, u) =>
                    s.jsx('p', { children: s.jsx(nt, { href: i.href, children: i.label }) }, u),
                  ),
                })
              : null,
            s.jsx(Gt, { name: 'extra' }),
          ],
        }),
        e.showHours && t
          ? s.jsx('div', {
              'data-part': 'hours',
              children: s.jsx(F, { name: 'store.HoursTable', hours: t.hours, status: t.status }),
            })
          : null,
      ],
    }),
  });
}
function qg({ settings: e }) {
  return e.text
    ? s.jsxs('div', {
        className: 'v-announcement',
        'data-part': 'root',
        'data-tone': e.tone,
        role: 'region',
        'aria-label': 'Aviso da loja',
        children: [
          s.jsx('span', { children: e.text }),
          e.href && e.linkLabel ? s.jsx(nt, { href: e.href, children: e.linkLabel }) : null,
        ],
      })
    : null;
}
function ey({ settings: e }) {
  const { cart: t } = Bt(),
    n = (t == null ? void 0 : t.status) === 'open' ? t.totals.itemCount : 0;
  return s.jsx('div', {
    className: 'v-section',
    'data-part': 'root',
    style: { paddingBlock: 8, display: 'flex', justifyContent: 'flex-end' },
    children: s.jsx(Sf, {
      asChild: !0,
      children: s.jsxs('button', {
        type: 'button',
        className: e.variant === 'pill' ? 'v-cart-pill' : 'v-link-btn',
        'data-part': 'trigger',
        children: [e.label, ' ', s.jsx('span', { className: 'v-cart-count', children: n })],
      }),
    }),
  });
}
function ty({ settings: e }) {
  const { params: t } = yo(),
    n = e.product || t.slug || '',
    { product: r, loading: l, error: o, refetch: a } = cf(n),
    { store: i, status: u } = ye(),
    { config: c } = G(),
    m = sn(),
    [d, f] = g.useState({}),
    [y, S] = g.useState(1),
    [x, E] = g.useState(null),
    [h, p] = g.useState(!1),
    v = (i == null ? void 0 : i.currency) ?? 'BRL',
    k = An(c).catalog,
    j = Pg('media', 'media');
  g.useEffect(() => {
    r && i && !e.product && (document.title = `${r.name} · ${i.name}`);
  }, [r, i, e.product]);
  const P = g.useMemo(() => (r == null ? void 0 : r.modifierGroups) ?? [], [r]),
    T = P.filter((I) => {
      var je;
      return (
        I.required &&
        (((je = d[I.id]) == null ? void 0 : je.length) ?? 0) < Math.max(1, I.minSelect)
      );
    }),
    _ = Object.fromEntries(T.map((I) => [I.id, x ? 'Escolha uma opção' : '']).filter(([, I]) => I));
  if (!n) return null;
  if (l && !r)
    return s.jsx('section', {
      className: 'v-section',
      'aria-busy': 'true',
      'aria-label': 'Carregando produto',
      'data-part': 'root',
      children: s.jsxs('div', {
        className: 'v-pp',
        'data-variant': e.variant,
        children: [s.jsx('div', { className: 'v-pp-media' }), s.jsx('div', {})],
      }),
    });
  if (!r)
    return s.jsx('section', {
      className: 'v-section',
      'data-part': 'root',
      children: s.jsxs('div', {
        className: 'v-panel v-empty',
        role: o ? 'alert' : void 0,
        children: [
          s.jsx('h1', {
            className: 'v-panel-title',
            children:
              o && o.code !== 'PRODUCT_NOT_FOUND'
                ? 'Não foi possível carregar o produto.'
                : 'Produto não encontrado.',
          }),
          o && o.code !== 'PRODUCT_NOT_FOUND'
            ? s.jsx('button', {
                type: 'button',
                className: 'v-btn v-btn-accent',
                onClick: a,
                children: 'Tentar novamente',
              })
            : s.jsx(nt, { href: k, className: 'v-btn v-btn-accent', children: e.backLabel }),
        ],
      }),
    });
  const A = r.status !== 'active',
    R = e.product ? 'h2' : 'h1';
  return s.jsxs('section', {
    className: 'v-section',
    'data-part': 'root',
    children: [
      e.product
        ? null
        : s.jsxs(nt, {
            href: k,
            className: 'v-back',
            'data-part': 'back',
            children: ['← ', e.backLabel],
          }),
      s.jsxs('article', {
        className: 'v-pp',
        'data-variant': e.variant,
        'data-status': r.status,
        children: [
          s.jsxs('div', {
            className: 'v-pp-media',
            'data-part': 'media',
            children: [
              s.jsx(Gt, { name: 'media', only: ['media'], className: 'v-pp-media-custom' }),
              s.jsx(Gt, { name: 'media', only: ['badge'], className: 'v-pp-media-badges' }),
              j
                ? null
                : r.imageUrl
                  ? s.jsx('img', {
                      src: r.imageUrl,
                      alt: r.name,
                      fetchPriority: 'high',
                      decoding: 'async',
                    })
                  : s.jsx('span', {
                      className: 'v-card-initial',
                      'aria-hidden': 'true',
                      'data-figure': r.figureVariant,
                      children: r.name.slice(0, 1).toUpperCase(),
                    }),
            ],
          }),
          s.jsxs('div', {
            className: 'v-pp-info',
            'data-part': 'info',
            children: [
              s.jsx(R, { className: 'v-page-title', 'data-part': 'name', children: r.name }),
              s.jsx('p', {
                className: 'v-pp-price v-num',
                'data-part': 'price',
                children: le(r.basePriceCents, v),
              }),
              s.jsx(Gt, { name: 'after-price', className: 'v-pp-area' }),
              e.showDescription && r.description
                ? s.jsx('p', {
                    className: 'v-pp-desc',
                    'data-part': 'description',
                    children: r.description,
                  })
                : null,
              P.length > 0
                ? s.jsx(F, {
                    name: 'catalog.ModifierPicker',
                    groups: P,
                    value: d,
                    currency: v,
                    errors: _,
                    onChange: (I, je) => {
                      (E(null), f((Ge) => ({ ...Ge, [I]: je })));
                    },
                  })
                : null,
              A
                ? s.jsx('p', {
                    className: 'v-alert',
                    role: 'status',
                    'data-part': 'sold-out',
                    children: e.soldOutText,
                  })
                : s.jsxs('div', {
                    className: 'v-pp-buy',
                    'data-part': 'buy',
                    children: [
                      s.jsxs('span', {
                        className: 'v-qty',
                        role: 'group',
                        'aria-label': 'Quantidade',
                        children: [
                          s.jsx('button', {
                            type: 'button',
                            'aria-label': 'Diminuir quantidade',
                            disabled: y <= 1,
                            onClick: () => S((I) => Math.max(1, I - 1)),
                            children: '−',
                          }),
                          s.jsx('output', { 'aria-live': 'polite', children: y }),
                          s.jsx('button', {
                            type: 'button',
                            'aria-label': 'Aumentar quantidade',
                            disabled: y >= 99,
                            onClick: () => S((I) => Math.min(99, I + 1)),
                            children: '+',
                          }),
                        ],
                      }),
                      s.jsx(Lg, {
                        product: r,
                        qty: y,
                        modifierIds: Object.values(d).flat(),
                        asChild: !0,
                        onAdded: () => {
                          (p(!0), e.afterAdd === 'cart' && m(An(c).cart));
                        },
                        onError: (I) =>
                          E(
                            I.code === 'MODIFIER_REQUIRED'
                              ? 'Escolha as opções obrigatórias antes de adicionar.'
                              : `Não foi possível adicionar (${I.message}).`,
                          ),
                        children: s.jsxs('button', {
                          type: 'button',
                          className: 'v-btn v-btn-accent',
                          disabled: T.length > 0 || u === 'paused',
                          'data-part': 'add',
                          children: [e.addLabel, ' · ', le(r.basePriceCents * y, v)],
                        }),
                      }),
                    ],
                  }),
              T.length > 0 && !A
                ? s.jsxs('p', {
                    className: 'v-muted',
                    role: 'note',
                    'data-part': 'missing',
                    children: ['Falta escolher: ', T.map((I) => I.name).join(', '), '.'],
                  })
                : null,
              h && e.afterAdd === 'stay'
                ? s.jsx('p', {
                    className: 'v-note',
                    role: 'status',
                    children: 'Adicionado à sacola.',
                  })
                : null,
              x ? s.jsx('p', { className: 'v-alert', role: 'alert', children: x }) : null,
              s.jsx(Gt, { name: 'after-cta', className: 'v-pp-area' }),
            ],
          }),
        ],
      }),
    ],
  });
}
const bo = (e) => e.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
function jf({ products: e, variant: t, currency: n }) {
  const { config: r } = G();
  return s.jsx('ol', {
    className: 'v-grid',
    'data-variant': t,
    'data-part': 'grid',
    children: e.map((l) =>
      s.jsx(
        'li',
        {
          'data-part': 'item',
          children: s.jsx(F, {
            name: 'catalog.ProductCard',
            product: l,
            currency: n,
            href: Zd(r, l.slug),
            link: (o) =>
              s.jsx(Og, {
                product: l,
                asChild: !0,
                children: s.jsx('a', {
                  'aria-label':
                    l.status === 'active'
                      ? `${l.name}, ${le(l.basePriceCents, n)}`
                      : `${l.name}, esgotado`,
                  children: o,
                }),
              }),
          }),
        },
        l.id,
      ),
    ),
  });
}
function ny({ settings: e }) {
  const { categories: t, loading: n, error: r, refetch: l } = uf(),
    { store: o } = ye(),
    { page: a } = yo(),
    [i, u] = g.useState('all'),
    [c, m] = g.useState(''),
    d = (o == null ? void 0 : o.currency) ?? 'BRL',
    f = t.filter((x) => x.products.some((E) => E.status !== 'archived')),
    y = bo(c.trim()),
    S = f
      .filter((x) => i === 'all' || x.id === i)
      .map((x) => ({
        ...x,
        products: x.products.filter(
          (E) =>
            E.status !== 'archived' &&
            (!y || bo(E.name).includes(y) || bo(E.description ?? '').includes(y)),
        ),
      }))
      .filter((x) => x.products.length > 0);
  return s.jsxs('section', {
    className: 'v-section',
    'data-part': 'root',
    id: 'cardapio',
    children: [
      s.jsx(qi, {
        eyebrow: e.eyebrow,
        title: e.title,
        intro: e.intro,
        as: a === 'catalog' ? 'h1' : 'h2',
      }),
      s.jsx(Gt, { name: 'before-grid' }),
      e.showSearch
        ? s.jsxs('form', {
            role: 'search',
            className: 'v-search',
            'data-part': 'search',
            onSubmit: (x) => x.preventDefault(),
            children: [
              s.jsx('label', {
                className: 'v-label',
                htmlFor: 'v-catalog-search',
                children: e.searchLabel,
              }),
              s.jsx('input', {
                id: 'v-catalog-search',
                type: 'search',
                className: 'v-input',
                value: c,
                maxLength: 80,
                onChange: (x) => m(x.target.value),
              }),
            ],
          })
        : null,
      e.showCategoryTabs && f.length > 1
        ? s.jsxs('nav', {
            className: 'v-tabs',
            'aria-label': 'Categorias',
            'data-part': 'tabs',
            children: [
              s.jsx('button', {
                type: 'button',
                className: 'v-tab',
                'aria-pressed': i === 'all',
                onClick: () => u('all'),
                children: e.allLabel,
              }),
              f.map((x) =>
                s.jsx(
                  'button',
                  {
                    type: 'button',
                    className: 'v-tab',
                    'aria-pressed': i === x.id,
                    onClick: () => u(x.id),
                    children: x.name,
                  },
                  x.id,
                ),
              ),
            ],
          })
        : null,
      n && t.length === 0
        ? s.jsx('div', {
            className: 'v-grid',
            'aria-busy': 'true',
            'aria-label': 'Carregando cardápio',
            children: Array.from({ length: 4 }, (x, E) =>
              s.jsx('div', { className: 'v-card-media' }, E),
            ),
          })
        : r && t.length === 0
          ? s.jsx(F, {
              name: 'system.ErrorFallback',
              error: { code: r.code, message: 'O cardápio não carregou.' },
              retry: l,
            })
          : S.length === 0
            ? s.jsx('p', {
                className: 'v-muted',
                'data-part': 'empty',
                children: y ? `Nada encontrado para “${c.trim()}”.` : e.emptyText,
              })
            : S.map((x) =>
                s.jsxs(
                  'div',
                  {
                    'data-part': 'category',
                    children: [
                      S.length > 1 || i === 'all'
                        ? s.jsx('h3', { className: 'v-cat-title', children: x.name })
                        : null,
                      s.jsx(jf, { products: x.products, variant: e.variant, currency: d }),
                    ],
                  },
                  x.id,
                ),
              ),
    ],
  });
}
function ry({ settings: e }) {
  var a;
  const { categories: t, loading: n } = uf(),
    { store: r } = ye(),
    o = (
      e.category
        ? (((a = t.find((i) => i.slug === e.category)) == null ? void 0 : a.products) ?? [])
        : t.flatMap((i) => i.products)
    )
      .filter((i) => i.status === 'active')
      .slice(0, e.limit);
  return !n && o.length === 0
    ? null
    : s.jsxs('section', {
        className: 'v-section',
        'data-part': 'root',
        children: [
          s.jsx(qi, { eyebrow: e.eyebrow, title: e.title, intro: e.intro }),
          n && o.length === 0
            ? s.jsx('div', {
                className: 'v-grid',
                'aria-busy': 'true',
                'aria-label': 'Carregando produtos',
                children: Array.from({ length: e.limit }, (i, u) =>
                  s.jsx('div', { className: 'v-card-media' }, u),
                ),
              })
            : s.jsx(jf, {
                products: o,
                variant: e.variant,
                currency: (r == null ? void 0 : r.currency) ?? 'BRL',
              }),
          e.ctaLabel && e.ctaHref
            ? s.jsx('p', {
                style: { marginTop: 24 },
                children: s.jsx(nt, {
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
function ly({ settings: e }) {
  const { store: t } = ye();
  return t
    ? s.jsx('section', {
        className: 'v-section',
        'data-part': 'root',
        'data-variant': e.variant,
        children: s.jsxs('div', {
          className: e.variant === 'card' ? 'v-panel v-status-card' : 'v-status-card',
          children: [
            s.jsxs('div', {
              style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
              children: [
                s.jsx('h2', {
                  className: 'v-section-title',
                  style: { margin: 0 },
                  children: e.title,
                }),
                s.jsx(wf, {}),
              ],
            }),
            e.showAddress && t.address
              ? s.jsxs('p', {
                  className: 'v-muted',
                  'data-part': 'address',
                  style: { margin: 0 },
                  children: [t.address, t.city ? `, ${t.city}` : ''],
                })
              : null,
            e.showHours
              ? s.jsx(F, { name: 'store.HoursTable', hours: t.hours, status: t.status })
              : null,
          ],
        }),
      })
    : null;
}
function oy({ settings: e }) {
  const { page: t } = yo(),
    n = (e.body ?? '').split(/\n{2,}/).filter(Boolean);
  return !e.title && n.length === 0
    ? null
    : s.jsxs('section', {
        className: 'v-section v-rich',
        'data-part': 'root',
        children: [
          s.jsx(qi, {
            eyebrow: e.eyebrow,
            title: e.title,
            as: t.startsWith('page:') ? 'h1' : 'h2',
          }),
          n.map((r, l) => s.jsx('p', { children: r }, l)),
        ],
      });
}
const Ne = (e, t) => ({ schema: e, Component: t, source: 'sdk' }),
  ay = [
    Ne(Fg, Xg),
    Ne($g, Jg),
    Ne(Ag, Zg),
    Ne(Ug, qg),
    Ne(Bg, ey),
    Ne(Vg, ty),
    Ne(Wg, ny),
    Ne(Hg, ry),
    Ne(Qg, ly),
    Ne(Kg, oy),
    Ne(bg, zg),
    Ne(Yg, Ig),
    Ne(Gg, Mg),
  ];
function iy({ item: e, currency: t }) {
  const { mutations: n } = Bt(),
    [r, l] = g.useState(!1),
    o = async (a) => {
      l(!0);
      try {
        await a();
      } catch (i) {
        ho(i);
      } finally {
        l(!1);
      }
    };
  return s.jsx(F, {
    name: 'cart.LineItem',
    item: e,
    currency: t,
    pending: r,
    onQty: (a) => void o(() => (a <= 0 ? n.remove(e.id) : n.updateQty(e.id, Math.min(a, 99)))),
    onRemove: () => void o(() => n.remove(e.id)),
  });
}
function sy() {
  const { cart: e, loading: t } = Bt(),
    { store: n } = ye(),
    { config: r } = G(),
    l = sn(),
    o = (n == null ? void 0 : n.currency) ?? 'BRL',
    a = () => l(An(r).catalog),
    i = (e == null ? void 0 : e.status) === 'open' && e.items.length > 0;
  return s.jsx('main', {
    id: 'main',
    className: 'v-page',
    'data-vendua-page': 'cart',
    children:
      t && !e
        ? s.jsx('div', {
            'aria-busy': 'true',
            'aria-label': 'Carregando sacola',
            className: 'v-panel',
          })
        : i
          ? s.jsx(F, {
              name: 'cart.Drawer',
              cart: e,
              currency: o,
              presentation: 'page',
              onClose: a,
              lines: e.items.map((u) => s.jsx(iy, { item: u, currency: o }, u.id)),
              summary: s.jsx(F, { name: 'checkout.Summary', cart: e, currency: o }),
              checkout: s.jsx(Rg, {
                asChild: !0,
                children: s.jsx('button', {
                  type: 'button',
                  className: 'v-btn v-btn-accent v-btn-block',
                  children: 'Ir para o pagamento',
                }),
              }),
            })
          : s.jsx(F, { name: 'checkout.EmptyCart', onBrowse: a }),
  });
}
const rr = ['dados', 'entrega', 'pagamento'],
  uy = { dados: 'Seus dados', entrega: 'Entrega', pagamento: 'Pagamento' },
  cy = [
    { id: 'pix', label: 'Pix' },
    { id: 'card_on_delivery', label: 'Cartão na entrega' },
    { id: 'cash', label: 'Dinheiro' },
  ];
function dy(e, t, n) {
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
function fy() {
  const { cart: e, loading: t, mutations: n } = Bt(),
    { store: r } = ye(),
    { zones: l } = tg(),
    { submit: o, pending: a, error: i, reset: u } = rg(),
    { customer: c, remember: m, forget: d } = og(),
    { config: f } = G(),
    y = sn(),
    S = An(f),
    x = (r == null ? void 0 : r.currency) ?? 'BRL',
    [E, h] = g.useState('dados'),
    [p, v] = g.useState(new Set()),
    [k, j] = g.useState(() => ({
      name: (c == null ? void 0 : c.name) ?? '',
      phone: (c == null ? void 0 : c.phone) ?? '',
      street: (c == null ? void 0 : c.address.street) ?? '',
      number: (c == null ? void 0 : c.address.number) ?? '',
      neighborhood: (c == null ? void 0 : c.address.neighborhood) ?? '',
      complement: (c == null ? void 0 : c.address.complement) ?? '',
      remember: !0,
    })),
    P = (r == null ? void 0 : r.deliveryEnabled) !== !1,
    T = (r == null ? void 0 : r.pickupEnabled) !== !1,
    [_, A] = g.useState(P ? 'delivery' : 'pickup'),
    [R, I] = g.useState('pix'),
    [je, Ge] = g.useState({}),
    [Kn, br] = g.useState(null),
    [bn, un] = g.useState(!1),
    N = g.useRef(!1),
    O = g.useRef(Date.now());
  g.useEffect(() => {
    (Ue('checkout_step', { step: E, duration_ms: Date.now() - O.current }),
      (O.current = Date.now()));
  }, [E]);
  const L = g.useMemo(() => l.flatMap((ee) => ee.neighborhoods), [l]),
    B = l.length ? Math.min(...l.map((ee) => ee.feeCents)) : null,
    J = [
      {
        mode: 'delivery',
        label: 'Entrega',
        ...(B !== null ? { detail: B > 0 ? `a partir de ${le(B, x)}` : 'grátis' } : {}),
        disabled: !P,
      },
      {
        mode: 'pickup',
        label: 'Retirada',
        detail: (r == null ? void 0 : r.address) ?? 'na loja',
        disabled: !T,
      },
    ];
  if (t && !e)
    return s.jsx('main', {
      id: 'main',
      className: 'v-page',
      'data-vendua-page': 'checkout',
      'aria-busy': 'true',
      'aria-label': 'Carregando checkout',
    });
  if (!e || e.status !== 'open' || e.items.length === 0)
    return s.jsx('main', {
      id: 'main',
      className: 'v-page',
      'data-vendua-page': 'checkout',
      children: s.jsx(F, { name: 'checkout.EmptyCart', onBrowse: () => y(S.catalog) }),
    });
  const Vt = (ee) => {
      (j((lt) => ({ ...lt, ...ee })),
        Ge((lt) => {
          const es = { ...lt };
          for (const _f of Object.keys(ee)) delete es[_f];
          return es;
        }));
    },
    rt = async () => {
      const ee = dy(E, k, _);
      if ((Ge(ee), !Object.keys(ee).length)) {
        if (E === 'entrega') {
          (un(!0), br(null));
          try {
            await n.setDelivery(
              _ === 'pickup' ? { mode: _ } : { mode: _, neighborhood: k.neighborhood.trim() },
            );
          } catch (lt) {
            br(Wa(ef(lt)).title);
          } finally {
            un(!1);
          }
        }
        (v((lt) => new Set(lt).add(E)), h(rr[rr.indexOf(E) + 1] ?? E));
      }
    },
    Yn = async () => {
      if (!(N.current || a)) {
        ((N.current = !0), u());
        try {
          const ee = [k.street.trim(), k.number.trim(), k.complement.trim()]
              .filter(Boolean)
              .join(', '),
            lt = await o({
              customer: { name: k.name.trim(), phone: k.phone.replace(/\D/g, '') },
              delivery:
                _ === 'pickup'
                  ? { mode: _ }
                  : { mode: _, neighborhood: k.neighborhood.trim(), address: ee },
              payment: { method: R },
            });
          (k.remember
            ? m({
                name: k.name,
                phone: k.phone,
                address: {
                  street: k.street,
                  number: k.number,
                  neighborhood: k.neighborhood,
                  complement: k.complement,
                },
              })
            : d(),
            y(`${S.order.replace(':id', lt.id)}?novo=1`));
        } catch {
        } finally {
          N.current = !1;
        }
      }
    },
    Re = i ? Wa(i.code) : null,
    cn = rr.map((ee) => ({ id: ee, label: uy[ee], done: p.has(ee) }));
  return s.jsxs('main', {
    id: 'main',
    className: 'v-page',
    'data-vendua-page': 'checkout',
    children: [
      s.jsx('h1', { className: 'v-page-title', children: 'Finalizar pedido' }),
      s.jsxs('div', {
        className: 'v-checkout-grid',
        children: [
          s.jsx(F, {
            name: 'checkout.Layout',
            steps: cn,
            current: E,
            onStep: (ee) => h(ee),
            children: s.jsxs('form', {
              noValidate: !0,
              'data-step': E,
              onSubmit: (ee) => {
                (ee.preventDefault(), E === 'pagamento' ? Yn() : rt());
              },
              children: [
                E === 'dados'
                  ? s.jsx(F, {
                      name: 'checkout.AddressForm',
                      part: 'customer',
                      value: k,
                      onChange: Vt,
                      errors: je,
                      neighborhoods: L,
                    })
                  : null,
                E === 'entrega'
                  ? s.jsxs(s.Fragment, {
                      children: [
                        s.jsx(F, {
                          name: 'checkout.DeliveryOptions',
                          options: J,
                          selected: _,
                          onSelect: A,
                        }),
                        _ === 'delivery'
                          ? s.jsx(F, {
                              name: 'checkout.AddressForm',
                              part: 'address',
                              value: k,
                              onChange: Vt,
                              errors: je,
                              neighborhoods: L,
                            })
                          : null,
                      ],
                    })
                  : null,
                E === 'pagamento'
                  ? s.jsxs(s.Fragment, {
                      children: [
                        s.jsx(F, {
                          name: 'checkout.PaymentMethods',
                          methods: cy,
                          selected: R,
                          onSelect: I,
                        }),
                        Kn
                          ? s.jsx('p', {
                              className: 'v-alert',
                              role: 'alert',
                              'data-part': 'delivery-issue',
                              children: Kn,
                            })
                          : null,
                        Re
                          ? s.jsxs('div', {
                              className: 'v-alert',
                              role: 'alert',
                              'data-vendua': 'checkout-error',
                              'data-code': i == null ? void 0 : i.code,
                              children: [
                                s.jsx('strong', { children: Re.title }),
                                Re.body ? s.jsxs('span', { children: [' ', Re.body] }) : null,
                              ],
                            })
                          : null,
                      ],
                    })
                  : null,
                s.jsxs('div', {
                  style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 },
                  children: [
                    E !== 'dados'
                      ? s.jsx('button', {
                          type: 'button',
                          className: 'v-btn v-btn-ghost',
                          onClick: () => h(rr[rr.indexOf(E) - 1] ?? 'dados'),
                          children: 'Voltar',
                        })
                      : null,
                    E === 'pagamento'
                      ? s.jsx('button', {
                          type: 'submit',
                          className: 'v-btn v-btn-accent',
                          disabled: a,
                          'aria-busy': a || void 0,
                          children: a
                            ? 'Enviando…'
                            : `Confirmar pedido · ${le(e.totals.totalCents, x)}`,
                        })
                      : s.jsx('button', {
                          type: 'submit',
                          className: 'v-btn v-btn-accent',
                          disabled: bn,
                          children: 'Continuar',
                        }),
                  ],
                }),
              ],
            }),
          }),
          s.jsx(F, { name: 'checkout.Summary', cart: e, currency: x }),
        ],
      }),
    ],
  });
}
const py = new Set(['delivered', 'cancelled', 'refunded']);
function my() {
  const { id: e = '' } = Yd(),
    { search: t } = Qn(),
    { order: n, loading: r, error: l, refetch: o } = ng(e),
    { store: a } = ye(),
    i = (a == null ? void 0 : a.currency) ?? 'BRL',
    u = new URLSearchParams(t).has('novo');
  return (
    g.useEffect(() => {
      if (!n || py.has(n.state)) return;
      const c = setInterval(o, 2e4);
      return () => clearInterval(c);
    }, [n, o]),
    s.jsx('main', {
      id: 'main',
      className: 'v-page',
      'data-vendua-page': 'order',
      children:
        r && !n
          ? s.jsx('div', {
              className: 'v-panel',
              'aria-busy': 'true',
              'aria-label': 'Carregando pedido',
            })
          : n
            ? s.jsxs(s.Fragment, {
                children: [
                  u ? s.jsx(F, { name: 'checkout.SuccessPage', order: n, currency: i }) : null,
                  s.jsx(F, {
                    name: 'order.StatusPage',
                    order: n,
                    currency: i,
                    timeline: s.jsx(F, { name: 'order.Timeline', events: n.timeline }),
                  }),
                  s.jsx('p', {
                    style: { marginTop: 24 },
                    children: s.jsx(nt, {
                      href: qe.orders,
                      className: 'v-btn v-btn-ghost',
                      children: 'Meus pedidos',
                    }),
                  }),
                ],
              })
            : s.jsx(F, {
                name: 'system.ErrorFallback',
                error: {
                  code: (l == null ? void 0 : l.code) ?? 'ORDER_NOT_FOUND',
                  message:
                    (l == null ? void 0 : l.code) === 'ORDER_NOT_FOUND' ||
                    (l == null ? void 0 : l.status) === 400
                      ? 'Pedido não encontrado neste aparelho.'
                      : 'O pedido não carregou.',
                },
                retry: o,
              }),
    })
  );
}
function hy() {
  const { orders: e, loading: t } = ig(),
    { store: n } = ye(),
    r = (n == null ? void 0 : n.currency) ?? 'BRL';
  return s.jsxs('main', {
    id: 'main',
    className: 'v-page',
    'data-vendua-page': 'orders',
    children: [
      s.jsx('h1', { className: 'v-page-title', children: 'Meus pedidos' }),
      s.jsx('p', { className: 'v-muted', children: 'Pedidos feitos neste aparelho.' }),
      t && e.length === 0
        ? s.jsx('div', {
            className: 'v-panel',
            'aria-busy': 'true',
            'aria-label': 'Carregando pedidos',
          })
        : e.length === 0
          ? s.jsxs('div', {
              className: 'v-panel v-empty',
              'data-part': 'empty',
              children: [
                s.jsx('p', {
                  className: 'v-panel-title',
                  children: 'Nenhum pedido por aqui ainda.',
                }),
                s.jsx(nt, {
                  href: '/',
                  className: 'v-btn v-btn-accent',
                  children: 'Fazer um pedido',
                }),
              ],
            })
          : s.jsx('ol', {
              className: 'v-order-list',
              'data-part': 'list',
              children: e.map((l) =>
                s.jsx(
                  'li',
                  {
                    children: s.jsxs(nt, {
                      href: qe.order.replace(':id', l.id),
                      'data-state': l.state,
                      children: [
                        s.jsxs('span', {
                          children: [
                            s.jsxs('strong', { children: ['Pedido #', l.number] }),
                            ' ',
                            s.jsx('span', {
                              className: 'v-muted',
                              children: new Date(l.placedAt).toLocaleDateString('pt-BR'),
                            }),
                          ],
                        }),
                        s.jsxs('span', {
                          children: [
                            go[l.state] ?? l.state,
                            ' ·',
                            ' ',
                            s.jsx('span', { className: 'v-num', children: le(l.totalCents, r) }),
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
function vy() {
  const { pathname: e } = Qn();
  return (
    g.useEffect(() => {
      Ue('page_view', {
        path: e,
        referrer: document.referrer ? new URL(document.referrer).host : '',
      });
    }, [e]),
    null
  );
}
function gy() {
  const e = yf('layout');
  return e
    ? s.jsx(vf, { value: { page: 'layout', params: {} }, children: s.jsx(kf, { template: e }) })
    : null;
}
function fl({ page: e }) {
  const t = yf(e),
    n = Yd(),
    { store: r } = ye();
  if (
    (g.useEffect(() => {
      r && e !== 'product' && (document.title = r.name);
    }, [r, e]),
    !t)
  )
    return s.jsx(Nf, {});
  const l = s.jsx(vf, {
    value: { page: e, params: n },
    children: s.jsx(kf, { template: t, only: (o) => o.type !== df }),
  });
  return s.jsx('main', { id: 'main', 'data-page': e, children: l });
}
function Nf() {
  const { pathname: e } = Qn();
  return s.jsx(F, { name: 'system.NotFound', path: e, homeHref: '/' });
}
function yy() {
  const { config: e } = G(),
    t = An(e),
    n = gf(),
    r = g.useMemo(
      () =>
        Object.keys(n)
          .map((o) => pg(o))
          .filter((o) => !!o),
      [n],
    ),
    l = new Set([t.home, t.catalog, ...Object.values(qe)]);
  return s.jsxs(jg, {
    sdk: ay,
    children: [
      s.jsx(vy, {}),
      s.jsxs(ev, {
        children: [
          Object.entries(e.redirects ?? {}).map(([o, a]) =>
            s.jsx(De, { path: o, element: s.jsx(Jh, { to: a, replace: !0 }) }, `r:${o}`),
          ),
          s.jsxs(De, {
            element: s.jsx(gy, {}),
            children: [
              s.jsx(De, { index: !0, element: s.jsx(fl, { page: 'home' }) }),
              s.jsx(De, { path: t.catalog, element: s.jsx(fl, { page: 'catalog' }) }),
              s.jsx(De, { path: t.product, element: s.jsx(fl, { page: 'product' }) }),
              s.jsx(De, { path: qe.cart, element: s.jsx(sy, {}) }),
              s.jsx(De, { path: qe.checkout, element: s.jsx(fy, {}) }),
              s.jsx(De, { path: qe.order, element: s.jsx(my, {}) }),
              s.jsx(De, { path: qe.orders, element: s.jsx(hy, {}) }),
              r
                .filter((o) => !l.has(`/${o}`))
                .map((o) =>
                  s.jsx(De, { path: `/${o}`, element: s.jsx(fl, { page: `page:${o}` }) }, `p:${o}`),
                ),
              s.jsx(De, { path: '*', element: s.jsx(Nf, {}) }),
            ],
          }),
        ],
      }),
    ],
  });
}
const xy = Ye({ type: 'store:boom', settings: {} });
function ky(e) {
  throw new Error('fixture section crash');
}
const Sy = Object.freeze(
    Object.defineProperty({ __proto__: null, default: ky, schema: xy }, Symbol.toStringTag, {
      value: 'Module',
    }),
  ),
  wy = {
    templates: {
      home: {
        version: 1,
        page: 'home',
        sections: [
          { id: 'boom', type: 'store:boom' },
          { id: 'future', type: 'sdk:not-shipped-yet' },
          { id: 'catalog', type: 'sdk:catalog-grid', settings: { title: 'Cardápio do fixture' } },
        ],
      },
    },
    tokens: null,
    source: 'repo',
  },
  Ey = Object.assign({ '/sections/boom.tsx': Sy }),
  jy = { snapshot: wy, sections: Ey },
  Ny = 'modulepreload',
  Cy = function (e) {
    return '/' + e;
  },
  ju = {},
  pl = function (t, n, r) {
    let l = Promise.resolve();
    if (n && n.length > 0) {
      document.getElementsByTagName('link');
      const a = document.querySelector('meta[property=csp-nonce]'),
        i = (a == null ? void 0 : a.nonce) || (a == null ? void 0 : a.getAttribute('nonce'));
      l = Promise.allSettled(
        n.map((u) => {
          if (((u = Cy(u)), u in ju)) return;
          ju[u] = !0;
          const c = u.endsWith('.css'),
            m = c ? '[rel="stylesheet"]' : '';
          if (document.querySelector(`link[href="${u}"]${m}`)) return;
          const d = document.createElement('link');
          if (
            ((d.rel = c ? 'stylesheet' : Ny),
            c || (d.as = 'script'),
            (d.crossOrigin = ''),
            (d.href = u),
            i && d.setAttribute('nonce', i),
            document.head.appendChild(d),
            c)
          )
            return new Promise((f, y) => {
              (d.addEventListener('load', f),
                d.addEventListener('error', () => y(new Error(`Unable to preload CSS for ${u}`))));
            });
        }),
      );
    }
    function o(a) {
      const i = new Event('vite:preloadError', { cancelable: !0 });
      if (((i.payload = a), window.dispatchEvent(i), !i.defaultPrevented)) throw a;
    }
    return l.then((a) => {
      for (const i of a || []) i.status === 'rejected' && o(i.reason);
      return t().catch(o);
    });
  },
  _y = {
    contract: 2,
    tokens: {
      color: {
        bg: '#FFFFFF',
        surface: '#FFFFFF',
        text: '#111111',
        muted: '#555555',
        accent: '#224466',
        onAccent: '#FFFFFF',
        danger: '#A33B32',
        success: '#3D7A4F',
      },
      font: { display: 'Georgia, serif', body: 'system-ui, sans-serif' },
      radius: { sm: '2px', md: '6px', lg: '10px' },
      space: { scale: 1 },
      motion: { duration: '150ms', easing: 'ease' },
    },
    overrides: {
      'system.Notice': () => pl(() => import('./Throws-ByWKxXYh.js'), []),
      'system.PromoNotice': () => pl(() => import('./Throws-ByWKxXYh.js'), []),
      'system.StorePausedNotice': () => pl(() => import('./Throws-ByWKxXYh.js'), []),
      'catalog.ProductCard': () => pl(() => import('./Throws-ByWKxXYh.js'), []),
    },
  },
  Cf = document.getElementById('root');
if (!Cf) throw new Error('missing #root');
Fd(Cf).render(
  s.jsx(g.StrictMode, {
    children: s.jsxs(jv, {
      config: _y,
      storefront: jy,
      children: [s.jsx(fg, {}), s.jsx(rv, { children: s.jsx(yy, {}) })],
    }),
  }),
);
