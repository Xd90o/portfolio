/* Mini-runtime du book de Romain : relie le HTML ({{trous}}) à la logique de chaque page. */
(function () {
  'use strict';
  var EVT = { onclick: 'click', oninput: 'input', onchange: 'change', onmouseenter: 'mouseenter', onmouseleave: 'mouseleave',
    onmousedown: 'mousedown', onmouseup: 'mouseup', onmousemove: 'mousemove', onpointerdown: 'pointerdown', onpointerup: 'pointerup',
    onpointermove: 'pointermove', onkeydown: 'keydown', onkeyup: 'keyup', onfocus: 'focus', onblur: 'blur', onsubmit: 'submit',
    onscroll: 'scroll', onwheel: 'wheel', ontouchstart: 'touchstart', ontouchend: 'touchend', ondblclick: 'dblclick' };
  var HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (o, cb) {
    if (typeof o === 'function') o = o(this.state, this.props);
    if (o) this.state = Object.assign({}, this.state, o);
    if (cb) (this.__cbs || (this.__cbs = [])).push(cb);
    if (this.__dc) this.__dc.schedule();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__dc) this.__dc.schedule(); };
  window.DCLogic = DCLogic;

  function get(obj, path) {
    var p = path.split('.'), v = obj;
    for (var i = 0; i < p.length; i++) { if (v == null) return undefined; v = v[p[i]]; }
    return v;
  }
  function parse(str) { // -> [texte, chemin, texte, chemin, ...]
    var out = [], last = 0, m; HOLE.lastIndex = 0;
    while ((m = HOLE.exec(str))) { out.push(str.slice(last, m.index), m[1]); last = m.index + m[0].length; }
    out.push(str.slice(last));
    return out;
  }
  function build(parts, vals) {
    if (parts.length === 3 && parts[0] === '' && parts[2] === '') return get(vals, parts[1]); // trou seul : valeur brute
    var s = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) s += parts[i];
      else { var v = get(vals, parts[i]); if (v != null && v !== false) s += v; }
    }
    return s;
  }
  function splitStyle(s) {
    var out = {}, depth = 0, start = 0;
    s = String(s);
    for (var i = 0; i <= s.length; i++) {
      var c = s.charAt(i);
      if (c === '(') depth++; else if (c === ')') depth--;
      else if ((c === ';' && depth === 0) || i === s.length) {
        var d = s.slice(start, i), k = d.indexOf(':');
        if (k > 0) {
          var name = d.slice(0, k).trim(), val = d.slice(k + 1).trim(), imp = '';
          if (/!important$/i.test(val)) { imp = 'important'; val = val.replace(/\s*!important$/i, ''); }
          if (name) out[name.indexOf('--') === 0 ? name : name.toLowerCase()] = [val, imp];
        }
        start = i + 1;
      }
    }
    return out;
  }

  function Mount(root, Comp) {
    var self = this;
    this.inst = new Comp({});
    if (!this.inst.state) this.inst.state = {};
    this.inst.__dc = this;
    this.attrs = []; this.texts = []; this.events = []; this.refs = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n, list = [];
    while ((n = walker.nextNode())) list.push(n);
    list.forEach(function (node) {
      if (node.nodeType === 3) {
        if (node.data.indexOf('{{') >= 0) { var p = parse(node.data); node.data = ''; self.texts.push({ node: node, parts: p }); }
        return;
      }
      var names = [];
      for (var i = 0; i < node.attributes.length; i++) if (node.attributes[i].name.indexOf('data-dc-') === 0) names.push(node.attributes[i].name);
      names.forEach(function (full) {
        var raw = node.getAttribute(full), name = full.slice(8), parts = parse(raw);
        node.removeAttribute(full);
        if (name === 'ref') { self.refs.push({ el: node, path: parts[1] }); return; }
        if (EVT[name]) {
          var evt = EVT[name], b = { el: node, path: parts[1], fn: null };
          node.addEventListener(evt, function (e) { if (typeof b.fn === 'function') return b.fn(e); });
          self.events.push(b); return;
        }
        self.attrs.push({ el: node, name: name, parts: parts, last: undefined, lastStyle: {} });
      });
    });
    this.pending = false;
    this.render();
    if (typeof this.inst.componentDidMount === 'function') this.inst.componentDidMount();
    window.addEventListener('pagehide', function () { if (typeof self.inst.componentWillUnmount === 'function') try { self.inst.componentWillUnmount(); } catch (e) {} });
  }
  Mount.prototype.schedule = function () {
    var self = this;
    if (this.pending) return;
    this.pending = true;
    (window.queueMicrotask || function (f) { Promise.resolve().then(f); })(function () { self.pending = false; self.render(); });
  };
  Mount.prototype.render = function () {
    var vals;
    try { vals = this.inst.renderVals() || {}; } catch (e) { console.error(e); return; }
    var i, b, v;
    for (i = 0; i < this.texts.length; i++) {
      b = this.texts[i]; v = build(b.parts, vals);
      v = (v == null || v === false) ? '' : String(v);
      if (b.node.data !== v) b.node.data = v;
    }
    for (i = 0; i < this.attrs.length; i++) this.setAttr(this.attrs[i], build(this.attrs[i].parts, vals));
    for (i = 0; i < this.events.length; i++) { b = this.events[i]; b.fn = get(vals, b.path); }
    for (i = 0; i < this.refs.length; i++) { b = this.refs[i]; v = get(vals, b.path); if (typeof v === 'function') try { v(b.el); } catch (e) { console.error(e); } }
    var cbs = this.inst.__cbs; this.inst.__cbs = null;
    if (cbs) cbs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
  };
  Mount.prototype.setAttr = function (b, v) {
    var el = b.el, name = b.name;
    if (name === 'style') {
      var next = (v == null || v === false) ? {} : splitStyle(v), prev = b.lastStyle, k;
      for (k in prev) if (!(k in next)) el.style.removeProperty(k);
      for (k in next) if (!prev[k] || prev[k][0] !== next[k][0] || prev[k][1] !== next[k][1]) el.style.setProperty(k, next[k][0], next[k][1]);
      b.lastStyle = next; return;
    }
    if (v === b.last) return;
    b.last = v;
    if (name === 'value') { var s = v == null ? '' : String(v); if (el.value !== s) el.value = s; return; }
    if (name === 'checked' || name === 'disabled') { el[name] = !!v && v !== 'false'; return; }
    if (v == null || v === false) el.removeAttribute(name);
    else el.setAttribute(name, v === true ? '' : String(v));
  };

  function boot() {
    var root = document.querySelector('x-dc');
    if (!root || !window.__DC) return;
    window.__dcMount = new Mount(root, window.__DC);
    root.removeAttribute('data-dc-boot');
    // perf : on met en pause les vidéos en boucle hors de l'écran
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          var v = e.target;
          if (e.isIntersecting) { if (v.paused && v.autoplay) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
          else if (!v.paused && v.loop) v.pause();
        });
      }, { rootMargin: '200px' });
      document.querySelectorAll('video[autoplay][loop]').forEach(function (v) { io.observe(v); });
    }
  }
  window.__dcBoot = boot;
})();
