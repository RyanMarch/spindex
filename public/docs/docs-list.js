document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    let currentQuery = (params.get('q') || '').trim();
    let currentCategory = (params.get('category') || '').trim();
    let currentFilter = (params.get('filter') || '').trim();

    const titleEl = document.getElementById('list-title');
    const subtitleEl = document.getElementById('list-subtitle');
    const badgeEl = document.getElementById('list-badge');
    const resultsContainer = document.getElementById('list-results');
    const searchInput = document.getElementById('list-search-input');
    const suggestionPills = document.querySelectorAll('.suggestion-pill');

    let searchIndexData = null;

    // Load and filter index initially
    fetch('search-index.json')
        .then(res => {
            if (!res.ok) throw new Error('Failed to load search index');
            return res.json();
        })
        .then(index => {
            searchIndexData = index;

            // Initialize search input value
            if (currentQuery) {
                searchInput.value = currentQuery;
            }

            updateUI();
        })
        .catch(err => {
            console.error(err);
            resultsContainer.innerHTML = `<div class="list-error">Error loading search index. Please try again.</div>`;
        });

    // Set up search input listener for real-time filtering
    searchInput?.addEventListener('input', () => {
        currentQuery = searchInput.value.trim();
        currentCategory = '';
        currentFilter = '';

        // Update URL parameters
        const newParams = new URLSearchParams();
        if (currentQuery) {
            newParams.set('q', currentQuery);
        }
        history.replaceState(null, '', `?${newParams.toString()}`);

        updateUI();
    });

    // Set up suggestion pills click listener
    suggestionPills.forEach(pill => {
        pill.addEventListener('click', () => {
            const type = pill.getAttribute('data-type');
            const val = pill.getAttribute('data-value');

            if (type === 'query') {
                currentQuery = val;
                currentCategory = '';
                currentFilter = '';
                if (searchInput) searchInput.value = currentQuery;

                const newParams = new URLSearchParams();
                newParams.set('q', currentQuery);
                history.replaceState(null, '', `?${newParams.toString()}`);
            } else if (type === 'category') {
                currentQuery = '';
                currentCategory = val;
                currentFilter = '';
                if (searchInput) searchInput.value = '';

                const newParams = new URLSearchParams();
                newParams.set('category', currentCategory);
                history.replaceState(null, '', `?${newParams.toString()}`);
            } else if (type === 'recent') {
                currentQuery = '';
                currentCategory = '';
                currentFilter = 'recent';
                if (searchInput) searchInput.value = '';

                const newParams = new URLSearchParams();
                newParams.set('filter', 'recent');
                history.replaceState(null, '', `?${newParams.toString()}`);
            }

            updateUI();
        });
    });

    function updateUI() {
        if (!searchIndexData) return;

        // Update active state of pills
        suggestionPills.forEach(pill => {
            const type = pill.getAttribute('data-type');
            const val = pill.getAttribute('data-value');

            let isActive = false;
            if (type === 'query' && currentQuery.toLowerCase() === (val || '').toLowerCase()) {
                isActive = true;
            } else if (type === 'category' && currentCategory.toLowerCase() === (val || '').toLowerCase()) {
                isActive = true;
            } else if (type === 'recent' && currentFilter === 'recent') {
                isActive = true;
            }
            pill.classList.toggle('active', isActive);
        });

        let filtered = [];

        if (currentCategory) {
            document.title = `${currentCategory} Articles | Spindex Docs`;
            if (titleEl) titleEl.textContent = `${currentCategory} Articles`;
            if (subtitleEl) subtitleEl.textContent = `All documentation guides in the ${currentCategory} category.`;
            if (badgeEl) {
                badgeEl.textContent = 'Category';
                badgeEl.style.display = 'inline-block';
            }

            filtered = searchIndexData.filter(item => item.category && item.category.toLowerCase() === currentCategory.toLowerCase());
        } else if (currentFilter === 'recent') {
            document.title = `Recently Updated | Spindex Docs`;
            if (titleEl) titleEl.textContent = 'Recently Updated';
            if (subtitleEl) subtitleEl.textContent = 'Showing recently updated documentation guides.';
            if (badgeEl) badgeEl.style.display = 'none';

            // Sort items by lastUpdated descending, return top 5
            filtered = [...searchIndexData]
                .filter(item => item.lastUpdated)
                .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
                .slice(0, 5);
        } else if (currentQuery) {
            document.title = `Search results for "${currentQuery}" | Spindex Docs`;
            if (titleEl) titleEl.textContent = 'Search Results';
            if (subtitleEl) subtitleEl.innerHTML = `Showing articles matching "<strong class="highlight-term">${escapeHtml(currentQuery)}</strong>"`;
            if (badgeEl) badgeEl.style.display = 'none';

            const qLower = currentQuery.toLowerCase();
            filtered = searchIndexData
                .map(item => {
                    const titleLower = (item.title || '').toLowerCase();
                    const categoryLower = (item.category || '').toLowerCase();

                    let score = 0;
                    if (titleLower === qLower) {
                        score += 100;
                    } else if (titleLower.startsWith(qLower)) {
                        score += 80;
                    } else if (titleLower.includes(qLower)) {
                        score += 50;
                    }

                    if (categoryLower.includes(qLower)) {
                        score += 30;
                    }

                    const matchingHeadings = (item.headings || []).filter(h => h.toLowerCase().includes(qLower));
                    if (matchingHeadings.length > 0) {
                        score += matchingHeadings.length * 15;
                    }

                    if ((item.excerpt || '').toLowerCase().includes(qLower)) {
                        score += 20;
                    }
                    return { item, score };
                })
                .filter(res => res.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(res => res.item);

            logDocsSearchTelemetry(currentQuery, filtered.length);
        } else {
            document.title = `All Guides | Spindex Docs`;
            if (titleEl) titleEl.textContent = 'All Guides';
            if (subtitleEl) subtitleEl.textContent = `Browse all documentation guides in the Spindex help center.`;
            if (badgeEl) badgeEl.style.display = 'none';
            filtered = searchIndexData;
        }

        renderResults(filtered, currentQuery);
    }

    let docsSearchLogTimer = null;
    function logDocsSearchTelemetry(query, resultsCount) {
        if (!query || query.length < 2) return;
        clearTimeout(docsSearchLogTimer);
        docsSearchLogTimer = setTimeout(() => {
            try {
                fetch('/api/docs/search-log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: query.trim(), results_count: resultsCount })
                }).catch(() => {});
            } catch {}
        }, 850);
    }

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function highlightText(text, term) {
        if (!term) return escapeHtml(text);
        const mathEscTerm = term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${mathEscTerm})`, 'gi');
        return escapeHtml(text).replace(regex, '<mark class="search-highlight">$1</mark>');
    }

    function renderResults(results, term) {
        if (!resultsContainer) return;
        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="list-empty-state">
                    <div class="empty-state-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </div>
                    <h3>No matching guides found</h3>
                    <p>We couldn't find any documentation matching your search criteria. Try using different keywords or browsing the categories.</p>
                    <button id="clear-search-btn" class="btn-primary">Clear Search</button>
                </div>
            `;

            document.getElementById('clear-search-btn')?.addEventListener('click', () => {
                currentQuery = '';
                currentCategory = '';
                currentFilter = '';
                if (searchInput) searchInput.value = '';
                history.replaceState(null, '', window.location.pathname);
                updateUI();
            });
            return;
        }

        resultsContainer.innerHTML = results.map(item => {
            const highlightedTitle = highlightText(item.title, term);
            const highlightedExcerpt = highlightText(item.excerpt, term);
            const categoryUrl = `list.html?category=${encodeURIComponent(item.category)}`;

            const dateBadge = currentFilter === 'recent' && item.lastUpdated
                ? `<span class="result-item-date">Updated: ${item.lastUpdated}</span>`
                : '';

            return `
                <div class="result-list-item">
                    <div class="result-item-meta">
                        <a href="${categoryUrl}" class="result-item-category">${escapeHtml(item.category)}</a>
                        ${dateBadge}
                    </div>
                    <h2 class="result-item-title">
                        <a href="${item.path}">${highlightedTitle}</a>
                    </h2>
                    <p class="result-item-excerpt">${highlightedExcerpt}</p>
                    <div class="result-item-action">
                        <a href="${item.path}" class="read-more-link">
                            Read Guide
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                        </a>
                    </div>
                </div>
            `;
        }).join('');
    }
});
