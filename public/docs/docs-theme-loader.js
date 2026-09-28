(function () {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
        document.documentElement.setAttribute('data-theme', stored);
        document.documentElement.removeAttribute('data-theme-mode');
    } else {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme-mode', 'system');
    }
})();
