// Clipboard polyfill for older browsers
document.addEventListener('DOMContentLoaded', function() {
    if (!window.Clipboard) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/clipboard-polyfill@2.8.6/build/clipboard-polyfill.js';
      document.head.appendChild(script);
    }
  });