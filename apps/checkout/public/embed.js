/*!
 * SettleKit embed: open a SettleKit checkout, payment link or invoice in an
 * overlay on your own site.
 *
 *   <script src="https://YOUR-CHECKOUT/embed.js" async></script>
 *   <a href="https://YOUR-CHECKOUT/l/your-link" data-settlekit-checkout>Buy</a>
 *
 * or from code:
 *
 *   SettleKit.open("https://YOUR-CHECKOUT/l/your-link", {
 *     onSuccess: function (event) { ... event.sessionId, event.paymentId ... },
 *     onClose: function () { ... },
 *   });
 *
 * A clicked link also dispatches a "settlekit:success" DOM event on itself.
 * Success messages are only sent to sites listed in the seller's embed
 * origins (dashboard Settings), and this script only accepts messages from
 * the checkout it was loaded from. Without JavaScript the link still works.
 */
(function () {
  "use strict";
  if (window.SettleKit && window.SettleKit.__loaded) return;

  var script = document.currentScript;
  var CHECKOUT_ORIGIN = script && script.src ? new URL(script.src).origin : window.location.origin;
  var PATH_RE = /^\/(l|c|i)\//;
  var current = null;

  function isCheckoutUrl(raw) {
    try {
      var url = new URL(raw, window.location.href);
      return url.origin === CHECKOUT_ORIGIN && PATH_RE.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  function embedUrl(raw) {
    var url = new URL(raw, window.location.href);
    url.searchParams.set("embed", "1");
    url.searchParams.set("embed_origin", window.location.origin);
    return url.toString();
  }

  function el(tag, style, attrs) {
    var node = document.createElement(tag);
    node.setAttribute("style", style);
    for (var key in attrs || {}) node.setAttribute(key, attrs[key]);
    return node;
  }

  function close() {
    if (!current) return;
    var done = current;
    current = null;
    window.removeEventListener("message", done.onMessage);
    document.removeEventListener("keydown", done.onKey);
    document.body.style.overflow = done.overflow;
    if (done.overlay.parentNode) done.overlay.parentNode.removeChild(done.overlay);
    if (done.opener) done.opener.focus();
    if (typeof done.options.onClose === "function") done.options.onClose();
  }

  function open(rawUrl, options) {
    options = options || {};
    if (!isCheckoutUrl(rawUrl)) {
      throw new Error("SettleKit.open: the URL must be a checkout, payment link or invoice on " + CHECKOUT_ORIGIN);
    }
    close();
    var overlay = el(
      "div",
      "position:fixed;inset:0;z-index:2147483646;background:rgba(15,15,20,.55);display:flex;align-items:center;justify-content:center;padding:16px;",
      { role: "dialog", "aria-modal": "true", "aria-label": "Checkout" },
    );
    var frame = el(
      "iframe",
      "width:100%;max-width:480px;height:min(760px,100%);border:0;border-radius:16px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.35);",
      { src: embedUrl(rawUrl), title: "Checkout", allow: "clipboard-write; payment" },
    );
    var bar = el("div", "position:absolute;top:12px;right:12px;display:flex;gap:8px;");
    var newTab = el(
      "a",
      "font:14px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.4);padding:8px 12px;border-radius:999px;text-decoration:none;",
      { href: rawUrl, target: "_blank", rel: "noopener" },
    );
    newTab.textContent = "Open in new tab";
    var closeBtn = el(
      "button",
      "font:14px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.4);border:0;padding:8px 12px;border-radius:999px;cursor:pointer;",
      { type: "button", "aria-label": "Close checkout" },
    );
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    bar.appendChild(newTab);
    bar.appendChild(closeBtn);
    overlay.appendChild(frame);
    overlay.appendChild(bar);

    var onMessage = function (event) {
      if (event.origin !== CHECKOUT_ORIGIN || event.source !== frame.contentWindow) return;
      var data = event.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (data.type === "settlekit:success") {
        var detail = { sessionId: String(data.sessionId || ""), paymentId: String(data.paymentId || "") };
        if (typeof options.onSuccess === "function") options.onSuccess(detail);
        if (options.element) {
          options.element.dispatchEvent(new CustomEvent("settlekit:success", { detail: detail, bubbles: true }));
        }
      } else if (data.type === "settlekit:close") {
        close();
      }
    };
    var onKey = function (event) {
      if (event.key === "Escape") close();
    };
    current = {
      overlay: overlay,
      options: options,
      onMessage: onMessage,
      onKey: onKey,
      opener: document.activeElement,
      overflow: document.body.style.overflow,
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
    closeBtn.focus();
    return { close: close };
  }

  function bind(root) {
    var links = (root || document).querySelectorAll("[data-settlekit-checkout]");
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.__settlekitBound) continue;
      link.__settlekitBound = true;
      link.addEventListener("click", function (event) {
        var target = event.currentTarget;
        var href = target.getAttribute("data-settlekit-url") || target.getAttribute("href");
        if (!href || !isCheckoutUrl(href)) return;
        event.preventDefault();
        open(href, { element: target });
      });
    }
  }

  window.SettleKit = { open: open, close: close, bind: bind, __loaded: true };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind();
    });
  } else {
    bind();
  }
})();
