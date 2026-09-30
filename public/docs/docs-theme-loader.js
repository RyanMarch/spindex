(function () {
    try {
        localStorage.removeItem('theme');
    } catch (_) {}
    document.documentElement.setAttribute('data-theme', 'dark');
})();
