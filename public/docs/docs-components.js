/**
 * Custom Native Web Components for reusable helpdocs layout
 */

// Helper to extract word stem for robust search matching
function stemWord(word) {
    let stemmed = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (stemmed.endsWith('ing')) stemmed = stemmed.slice(0, -3);
    else if (stemmed.endsWith('ed')) stemmed = stemmed.slice(0, -2);
    else if (stemmed.endsWith('es')) stemmed = stemmed.slice(0, -2);
    else if (stemmed.endsWith('s') && !stemmed.endsWith('ss')) stemmed = stemmed.slice(0, -1);

    if (stemmed.endsWith('e')) stemmed = stemmed.slice(0, -1);
    return stemmed;
}

// Check if target text matches the query using word stems
function stemMatch(targetText, queryText) {
    const queryStems = queryText.split(/\s+/).map(stemWord).filter(Boolean);
    const targetWords = targetText.split(/\s+/).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);

    if (queryStems.length === 0) return false;

    // Return true if every query word stem matches at least one word in the target text
    return queryStems.every(qStem => {
        return targetWords.some(tWord => {
            const tStem = stemWord(tWord);
            return tWord.startsWith(qStem) || tStem.startsWith(qStem) || qStem.startsWith(tStem);
        });
    });
}

class DocsLogo extends HTMLElement {
    connectedCallback() {
        this.innerHTML =  /*html*/ `
            <svg width="24" height="24" viewBox="0 0 172 172" fill="none" aria-hidden="true">
                <circle cx="62" cy="86" r="54" fill="#f4f4f7"/>
                <circle cx="62" cy="86" r="38" fill="none" stroke="#0c0c10" stroke-width="4" opacity="0.25"/>
                <circle cx="62" cy="86" r="14" fill="#0c0c10"/>
                <rect x="120" y="48" width="46" height="20" rx="10" fill="#f43f5e"/>
                <rect x="120" y="76" width="46" height="20" rx="10" fill="#fb7185"/>
                <rect x="120" y="104" width="28" height="20" rx="10" fill="#fda4af"/>
            </svg>
        `;
    }
}
customElements.define('docs-logo', DocsLogo);

class DocsHeaderNav extends HTMLElement {
    static get observedAttributes() {
        return ['items', 'active-tab', 'app-url', 'docs-url'];
    }

    constructor() {
        super();
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback() {
        this.render();
    }

    isSubpage() {
        const path = window.location.pathname;
        return /\/docs\/[^\/]+\//.test(path) || (!path.endsWith('/docs/') && path.split('/docs/')[1]?.length > 0 && path.split('/docs/')[1].includes('/'));
    }

    render() {
        const basePath = this.isSubpage() ? '../' : '';
        const appUrl = this.getAttribute('app-url') || `${basePath}../`;
        const docsUrl = this.getAttribute('docs-url') || `${basePath}./`;
        const activeTab = this.getAttribute('active-tab');

        let navItems = [];
        const itemsAttr = this.getAttribute('items');
        if (itemsAttr) {
            try {
                navItems = JSON.parse(itemsAttr);
            } catch (e) {
                console.error('Failed to parse items attribute on docs-header-nav:', e);
            }
        }

        if (!navItems || navItems.length === 0) {
            navItems = [
                { title: 'App', href: appUrl, id: 'app' },
                { title: 'Guides', href: docsUrl, id: 'guides' }
            ];
        }

        const currentPath = window.location.pathname;

        this.innerHTML = navItems.map(item => {
            let href = item.href;
            if (this.isSubpage() && (href.startsWith('./') || href.startsWith('../'))) {
                href = basePath + href;
            }

            let isActive = false;
            if (activeTab) {
                isActive = item.id === activeTab || item.title?.toLowerCase() === activeTab.toLowerCase();
            } else {
                const linkPath = new URL(href, window.location.origin).pathname;
                if (item.id === 'guides' && (currentPath.endsWith('/docs/') || currentPath.includes('/docs/'))) {
                    isActive = true;
                } else if (item.id === 'app' && !currentPath.includes('/docs/')) {
                    isActive = true;
                } else if (linkPath !== '/' && currentPath.includes(linkPath)) {
                    isActive = true;
                }
            }

            const activeClass = isActive ? 'active' : '';
            return `<a href="${href}" class="nav-link ${activeClass}" ${item.id ? `id="nav-link-${item.id}"` : ''}>${item.title}</a>`;
        }).join('');
    }
}
customElements.define('docs-header-nav', DocsHeaderNav);

class DocsHeader extends HTMLElement {
    constructor() {
        super();
        this.index = null;
        this.isLoading = false;
        this.config = {};
    }

    isSubpage() {
        const path = window.location.pathname;
        return /\/docs\/[^\/]+\//.test(path) || (!path.endsWith('/docs/') && path.split('/docs/')[1]?.length > 0 && path.split('/docs/')[1].includes('/'));
    }

    connectedCallback() {
        this.style.display = 'contents';
        const basePath = this.isSubpage() ? '../' : '';
        const appUrl = this.getAttribute('app-url') || `${basePath}../`;
        const docsUrl = this.getAttribute('docs-url') || `${basePath}./`;
        const showLogo = this.getAttribute('show-logo') !== 'false';

        fetch(`${basePath}docs-config.json`)
            .then(r => r.ok ? r.json() : null)
            .then(config => {
                this.config = config || {};
                const projectName = this.config.projectName || 'Help Center';
                this.render(projectName, appUrl, docsUrl, showLogo);
            })
            .catch(() => {
                this.config = {};
                this.render('Help Center', appUrl, docsUrl, showLogo);
            });
    }

    render(projectName, appUrl, docsUrl, showLogo) {
        const navItems = this.getAttribute('nav-items') || (this.config && this.config.navLinks ? JSON.stringify(this.config.navLinks) : '');
        const activeTab = this.getAttribute('active-tab') || '';

        this.innerHTML = /*html*/`
            <div class="header-search-backdrop"></div>
            <header class="app-header">
                ${showLogo ? `
                <a href="/" class="header-logo">
                    <docs-logo></docs-logo>
                    <h1>${projectName}</h1>
                </a>
                ` : ''}
                <div class="header-actions">
                    <docs-header-nav class="header-nav" aria-label="Main Navigation"
                        ${navItems ? `items='${navItems.replace(/'/g, "&apos;")}'` : ''}
                        ${activeTab ? `active-tab="${activeTab}"` : ''}
                        app-url="${appUrl}"
                        docs-url="${docsUrl}">
                    </docs-header-nav>
                    
                    <div class="header-search-container">
                        <input type="search" class="header-search-input" placeholder="Search guides..." aria-label="Search guides" autocomplete="off" />
                        <button class="header-search-button" aria-label="Search">
                            <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </button>
                        <div class="header-search-dropdown"></div>
                    </div>

                    <button id="mobile-nav-toggle" class="mobile-nav-toggle" aria-label="Toggle navigation menu" aria-expanded="false">
                        <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                        <svg class="close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </header>
        `;

        this.setupMobileNav();
        this.setupSearch();
    }

    setupMobileNav() {
        const toggleBtn = this.querySelector('#mobile-nav-toggle');
        const sidebar = document.querySelector('docs-sidebar');
        const overlay = document.querySelector('#mobile-overlay');
        const menuIcon = this.querySelector('.menu-icon');
        const closeIcon = this.querySelector('.close-icon');
        const headerNav = this.querySelector('.header-nav');

        if (!toggleBtn || !overlay) return;

        const toggleMenu = () => {
            let isOpen = false;

            if (this.isSubpage() && sidebar) {
                const pageSidebar = sidebar.querySelector('.page-sidebar');
                if (pageSidebar) {
                    isOpen = pageSidebar.classList.toggle('active');
                    overlay.classList.toggle('active', isOpen);
                }
            } else if (headerNav) {
                isOpen = headerNav.classList.toggle('active');
            }

            toggleBtn.setAttribute('aria-expanded', String(isOpen));

            if (isOpen) {
                if (menuIcon) menuIcon.style.display = 'none';
                if (closeIcon) closeIcon.style.display = 'block';
                if (this.isSubpage()) {
                    document.body.style.overflow = 'hidden';
                }
            } else {
                if (menuIcon) menuIcon.style.display = 'block';
                if (closeIcon) closeIcon.style.display = 'none';
                document.body.style.overflow = '';
            }
        };

        toggleBtn.addEventListener('click', toggleMenu);
        overlay.addEventListener('click', toggleMenu);

        // Close header dropdown menu when clicking outside
        document.addEventListener('click', (e) => {
            if (headerNav && headerNav.classList.contains('active')) {
                if (!headerNav.contains(e.target) && !toggleBtn.contains(e.target)) {
                    headerNav.classList.remove('active');
                    toggleBtn.setAttribute('aria-expanded', 'false');
                    if (menuIcon) menuIcon.style.display = 'block';
                    if (closeIcon) closeIcon.style.display = 'none';
                }
            }
        });

        // Clean up on scroll or resize if sidebar or menu is open
        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) {
                if (sidebar) {
                    const pageSidebar = sidebar.querySelector('.page-sidebar');
                    if (pageSidebar) pageSidebar.classList.remove('active');
                }
                if (headerNav) headerNav.classList.remove('active');
                overlay.classList.remove('active');
                toggleBtn.setAttribute('aria-expanded', 'false');
                if (menuIcon) menuIcon.style.display = 'block';
                if (closeIcon) closeIcon.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }

    async loadIndex() {
        if (this.index || this.isLoading) return;
        this.isLoading = true;

        try {
            const basePath = this.isSubpage() ? '../' : '';
            const response = await fetch(`${basePath}search-index.json`);
            if (response.ok) {
                this.index = await response.json();
            }
        } catch (e) {
            console.error('Failed to load search index:', e);
        } finally {
            this.isLoading = false;
        }
    }

    setupSearch() {
        const input = this.querySelector('.header-search-input');
        const button = this.querySelector('.header-search-button');
        const dropdown = this.querySelector('.header-search-dropdown');
        const backdrop = this.querySelector('.header-search-backdrop');
        const container = this.querySelector('.header-search-container');
        let selectedIndex = -1;

        if (!input || !dropdown || !backdrop) return;

        const openSearch = () => {
            container.classList.add('active');
            backdrop.classList.add('active');
            this.loadIndex();
            if (input.value.trim().length > 0) {
                dropdown.style.display = 'block';
            }
            document.body.style.overflow = 'hidden';
        };

        const closeSearch = () => {
            container.classList.remove('active');
            backdrop.classList.remove('active');
            dropdown.style.display = 'none';
            selectedIndex = -1;
            document.body.style.overflow = '';
        };

        input.addEventListener('focus', openSearch);
        button.addEventListener('click', () => {
            if (container.classList.contains('active') && input.value.trim().length === 0) {
                closeSearch();
            } else {
                input.focus();
            }
        });
        backdrop.addEventListener('click', closeSearch);

        input.addEventListener('input', () => {
            const query = input.value.trim().toLowerCase();
            if (!query) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                selectedIndex = -1;
                return;
            }

            if (!this.index) {
                dropdown.innerHTML = '<div class="search-status">Loading search...</div>';
                dropdown.style.display = 'block';
                return;
            }

            const results = this.index
                .map(item => {
                    const titleLower = item.title.toLowerCase();
                    const category = item.category || 'Guides';
                    const categoryLower = category.toLowerCase();

                    let score = 0;
                    if (titleLower === query) {
                        score += 100;
                    } else if (titleLower.startsWith(query)) {
                        score += 80;
                    } else if (titleLower.includes(query)) {
                        score += 50;
                    } else if (stemMatch(item.title, query)) {
                        score += 35;
                    }

                    if (categoryLower.includes(query)) {
                        score += 20;
                    }
                    if (item.headings.some(h => h.toLowerCase().includes(query))) {
                        score += 10;
                    } else if (item.headings.some(h => stemMatch(h, query))) {
                        score += 6;
                    }
                    if (item.excerpt.toLowerCase().includes(query)) {
                        score += 5;
                    } else if (item.excerpt.toLowerCase().includes(query) || stemMatch(item.excerpt, query)) {
                        score += 3;
                    }
                    return { item, score };
                })
                .filter(res => res.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(res => res.item);

            const basePath = this.isSubpage() ? '../' : '';
            let html = '';
            if (results.length === 0) {
                html += '<div class="search-status">No results found</div>';
            } else {
                html += results.slice(0, 5).map((item, idx) => {
                    return /*html*/ `
                        <a href="${basePath}${item.path}" class="search-result-item" data-index="${idx}">
                            <div class="result-title">${item.title}</div>
                            <div class="result-category">${item.category || 'Guides'}</div>
                            <div class="result-excerpt">${item.excerpt}</div>
                        </a>
                    `;
                }).join('');
            }

            html += /*html*/`
                <a href="${basePath}list.html?q=${encodeURIComponent(query)}" class="search-result-item full-search-row" data-index="${results.length}">
                    <div class="result-title">Full Search</div>
                    <div class="result-excerpt">See all results matching "${query}"</div>
                </a>
            `;
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
            selectedIndex = -1;
        });

        // Key navigation
        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.search-result-item');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % items.length;
                this.updateSelection(items, selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                this.updateSelection(items, selectedIndex);
            } else if (e.key === 'Enter') {
                if (selectedIndex >= 0 && selectedIndex < items.length) {
                    e.preventDefault();
                    items[selectedIndex].click();
                    closeSearch();
                }
            } else if (e.key === 'Escape') {
                closeSearch();
                input.blur();
            }
        });
    }

    updateSelection(items, index) {
        items.forEach((item, idx) => {
            if (idx === index) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }
}

class DocsSidebar extends HTMLElement {
    isSubpage() {
        const path = window.location.pathname;
        return /\/docs\/[^\/]+\//.test(path) || (!path.endsWith('/docs/') && path.split('/docs/')[1]?.length > 0 && path.split('/docs/')[1].includes('/'));
    }

    connectedCallback() {
        this.style.display = 'contents';
        const basePath = this.isSubpage() ? '../' : '';
        const appUrl = this.getAttribute('app-url') || `${basePath}../`;
        const prefix = this.isSubpage() ? '../' : './';

        fetch(`${basePath}docs-config.json`)
            .then(r => r.ok ? r.json() : null)
            .then(config => {
                const projectName = config ? config.projectName : 'Help Center';
                this.render(projectName, appUrl, prefix, config?.sidebarCta);
            })
            .catch(() => {
                this.render('Help Center', appUrl, prefix, null);
            });
    }

    render(projectName, appUrl, prefix, sidebarCta) {
        // Optional promo card pinned to the bottom of the sidebar, e.g.
        // "sidebarCta": { "title": "...", "description": "...", "buttonText": "...", "buttonUrl": "/app" }
        // in docs-config.json. Omit sidebarCta entirely to leave the sidebar without one.
        const ctaHtml = sidebarCta ? /*html*/ `
                <div class="sidebar-footer">
                    <div class="cta-card">
                        <div class="cta-card-icon">
                            <docs-logo></docs-logo>
                        </div>
                        <h4 class="cta-card-title">${sidebarCta.title || projectName}</h4>
                        <p class="cta-card-desc">${sidebarCta.description || ''}</p>
                        <a href="${sidebarCta.buttonUrl || appUrl}" class="btn-cta-generator">
                            <span>${sidebarCta.buttonText || `Go to ${projectName}`}</span>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                        </a>
                    </div>
                </div>` : '';

        this.innerHTML = /*html*/ `
            <nav class="page-sidebar" aria-label="Documentation sections">
                <div class="sidebar-logo">
                    <a href="/" class="logo-link">
                        <docs-logo></docs-logo>
                        <span class="sidebar-logo-text">${projectName}</span>
                    </a>
                </div>
                <ul class="sidebar-menu-list"></ul>
                ${ctaHtml}
            </nav>
        `;

        this.highlightActiveLink();
    }

    highlightActiveLink() {
        const currentHash = window.location.hash;

        // Insert category badge above the h1 in the content area
        const h1 = document.querySelector('.page-content h1');
        if (h1 && !document.querySelector('.doc-page-category')) {
            const basePath = this.isSubpage() ? '../' : '';
            fetch(`${basePath}search-index.json`)
                .then(r => r.json())
                .then(index => {
                    const currentPath = window.location.pathname;
                    const match = index.find(item => currentPath.endsWith(item.path) || item.path.includes(currentPath.split('/docs/')[1]));
                    const category = match ? match.category : 'Guides';

                    const categoryEl = document.createElement('a');
                    categoryEl.className = 'doc-page-category';
                    categoryEl.href = `${basePath}list.html?category=${encodeURIComponent(category)}`;
                    categoryEl.textContent = category;
                    h1.parentNode.insertBefore(categoryEl, h1);
                })
                .catch(e => console.error(e));
        }

        // Generate dynamic section links for the current page
        setTimeout(() => {
            const menuList = this.querySelector('.sidebar-menu-list');
            if (menuList) {
                // Add Overview link if #overview exists
                if (document.getElementById('overview')) {
                    const overviewLi = document.createElement('li');
                    const overviewLink = document.createElement('a');
                    overviewLink.href = '#overview';
                    overviewLink.className = 'sidebar-link';
                    overviewLink.textContent = 'Overview';
                    if (currentHash === '#overview' || !currentHash) {
                        overviewLink.classList.add('active');
                    }
                    overviewLi.appendChild(overviewLink);
                    menuList.appendChild(overviewLi);
                }

                const headings = Array.from(document.querySelectorAll('.page-content h2, .page-content h3'));
                let currentH2Li = null;
                let currentSublist = null;

                headings.forEach(heading => {
                    let id = heading.id;
                    if (!id) {
                        id = heading.textContent.toLowerCase().trim()
                            .replace(/[^\w\s-]/g, '')
                            .replace(/[\s_]+/g, '-')
                            .replace(/^-+|-+$/g, '');
                        heading.id = id;
                    }

                    const cloned = heading.cloneNode(true);
                    const anchor = cloned.querySelector('.heading-anchor');
                    if (anchor) {
                        anchor.remove();
                    }
                    const text = cloned.textContent.trim();

                    if (heading.tagName === 'H2') {
                        currentH2Li = document.createElement('li');
                        const link = document.createElement('a');
                        link.href = `#${id}`;
                        link.className = 'sidebar-link';
                        link.textContent = text;

                        if (currentHash === `#${id}`) {
                            link.classList.add('active');
                        }

                        currentH2Li.appendChild(link);
                        menuList.appendChild(currentH2Li);
                        currentSublist = null;
                    } else if (heading.tagName === 'H3' && currentH2Li) {
                        if (!currentSublist) {
                            currentSublist = document.createElement('ul');
                            currentSublist.className = 'sidebar-sublist';
                            currentH2Li.appendChild(currentSublist);
                        }
                        const subLi = document.createElement('li');
                        const subLink = document.createElement('a');
                        subLink.href = `#${id}`;
                        subLink.className = 'sidebar-link sub-link';
                        subLink.textContent = text;

                        if (currentHash === `#${id}`) {
                            subLink.classList.add('active');
                        }

                        subLi.appendChild(subLink);
                        currentSublist.appendChild(subLi);
                    }
                });
            }

            this.setupScrollSpy();
        }, 50);
    }

    setupScrollSpy() {
        const links = Array.from(this.querySelectorAll('.sidebar-link')).filter(l => l.getAttribute('href')?.startsWith('#'));
        if (links.length === 0) return;

        const targets = links.map(link => {
            const id = link.getAttribute('href').substring(1);
            return document.getElementById(id);
        }).filter(Boolean);

        if (targets.length === 0) return;

        const visibleTargets = new Map();

        const observerOptions = {
            root: null,
            rootMargin: '-10% 0px -55% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                visibleTargets.set(entry.target, entry.isIntersecting);
            });

            const activeTarget = targets.find(target => visibleTargets.get(target));

            if (activeTarget) {
                const activeId = activeTarget.getAttribute('id');
                links.forEach(link => {
                    link.classList.toggle('active', link.getAttribute('href') === `#${activeId}`);
                });
            } else if (window.scrollY < 100 && links.length > 0) {
                links.forEach((link, idx) => {
                    link.classList.toggle('active', idx === 0);
                });
            }
        }, observerOptions);

        targets.forEach(target => observer.observe(target));
    }
}

class DocsTableOfContents extends HTMLElement {
    connectedCallback() {
        this.style.display = 'contents';

        setTimeout(() => {
            const overviewEl = document.getElementById('overview');
            const headings = Array.from(document.querySelectorAll('.page-content h2, .page-content h3'));

            if (headings.length === 0 && !overviewEl) {
                this.innerHTML = '';
                return;
            }

            const nav = document.createElement('nav');
            nav.className = 'inline-toc';
            nav.setAttribute('aria-label', 'Table of contents');

            const titleDiv = document.createElement('div');
            titleDiv.className = 'toc-title';
            titleDiv.textContent = 'Table of Contents';
            nav.appendChild(titleDiv);

            const ul = document.createElement('ul');
            ul.className = 'toc-list';

            if (overviewEl) {
                const li = document.createElement('li');
                const a = document.createElement('a');
                a.href = '#overview';
                a.textContent = 'Overview';
                li.appendChild(a);
                ul.appendChild(li);
            }

            headings.forEach(heading => {
                let id = heading.id;
                if (!id) {
                    id = heading.textContent.toLowerCase().trim()
                        .replace(/[^\w\s-]/g, '')
                        .replace(/[\s_]+/g, '-')
                        .replace(/^-+|-+$/g, '');
                    heading.id = id;
                }

                const cloned = heading.cloneNode(true);
                const anchor = cloned.querySelector('.heading-anchor');
                if (anchor) {
                    anchor.remove();
                }
                const text = cloned.textContent.trim();

                const li = document.createElement('li');
                if (heading.tagName === 'H3') {
                    li.className = 'toc-subitem';
                }
                const a = document.createElement('a');
                a.href = `#${id}`;
                a.textContent = text;
                li.appendChild(a);
                ul.appendChild(li);
            });

            nav.appendChild(ul);
            this.innerHTML = '';
            this.appendChild(nav);
        }, 50);
    }
}
customElements.define('docs-table-of-contents', DocsTableOfContents);

class DocsAnchorHelper extends HTMLElement {
    connectedCallback() {
        this.style.display = 'contents';
        const headings = this.querySelectorAll('h1, h2, h3');

        function getHeadingId(heading) {
            if (heading.id) return heading.id;

            const slug = heading.textContent.toLowerCase().trim()
                .replace(/[^\w\s-]/g, '')
                .replace(/[\s_]+/g, '-')
                .replace(/^-+|-+$/g, '');

            let uniqueSlug = slug;
            let count = 1;
            while (document.getElementById(uniqueSlug)) {
                uniqueSlug = `${slug}-${count}`;
                count++;
            }

            heading.id = uniqueSlug;
            return uniqueSlug;
        }

        headings.forEach(heading => {
            if (heading.tagName === 'H1' && heading.textContent.trim() === 'User Guide') {
                return;
            }

            const id = getHeadingId(heading);
            if (!id) return;

            if (heading.querySelector('.heading-anchor')) return;

            const anchor = document.createElement('a');
            anchor.className = 'heading-anchor';
            anchor.href = `#${id}`;
            anchor.setAttribute('aria-label', 'Copy link to this section');

            const linkIconSvg = `
                <svg class="anchor-svg-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
            `;

            const checkIconSvg = `
                <svg class="anchor-svg-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;

            anchor.innerHTML = linkIconSvg + checkIconSvg;
            heading.appendChild(anchor);

            anchor.addEventListener('click', (e) => {
                e.preventDefault();
                const url = `${window.location.origin}${window.location.pathname}#${id}`;

                navigator.clipboard.writeText(url).then(() => {
                    history.pushState(null, null, `#${id}`);
                    heading.scrollIntoView({ behavior: 'smooth' });

                    const linkIcon = anchor.querySelector('.anchor-svg-link');
                    const checkIcon = anchor.querySelector('.anchor-svg-check');

                    if (linkIcon && checkIcon) {
                        linkIcon.style.display = 'none';
                        checkIcon.style.display = 'inline-block';
                        anchor.classList.add('copied');

                        setTimeout(() => {
                            linkIcon.style.display = 'inline-block';
                            checkIcon.style.display = 'none';
                            anchor.classList.remove('copied');
                        }, 2000);
                    }
                });
            });
        });

        this.wireLightbox();
    }

    // Opens screenshots embedded via <figure class="doc-screenshot-figure"><img>...</figure>
    // in the shared #lightbox-modal (markup lives once per page, outside this component).
    wireLightbox() {
        const images = this.querySelectorAll('.doc-screenshot-figure img');
        if (images.length === 0) return;

        const modal = document.getElementById('lightbox-modal');
        const modalImg = document.getElementById('lightbox-img');
        const modalCaption = document.getElementById('lightbox-caption');
        if (!modal || !modalImg) return;

        const openLightbox = (img) => {
            modalImg.src = img.currentSrc || img.src;
            modalImg.alt = img.alt || '';
            const caption = img.closest('figure')?.querySelector('figcaption');
            if (modalCaption) modalCaption.textContent = caption ? caption.textContent : '';
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        };

        const closeLightbox = () => {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        };

        images.forEach(img => {
            img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            img.setAttribute('aria-label', 'Click to enlarge image');
            img.addEventListener('click', () => openLightbox(img));
            img.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openLightbox(img);
                }
            });
        });

        // The modal itself is shared across every doc-anchor-helper instance on the
        // page (there's only ever one #lightbox-modal), so only bind its own
        // controls once even if this runs more than once.
        if (!modal.dataset.lightboxWired) {
            modal.dataset.lightboxWired = 'true';
            modal.querySelector('.lightbox-close')?.addEventListener('click', closeLightbox);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeLightbox();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('active')) closeLightbox();
            });
        }
    }
}

class DocsSearch extends HTMLElement {
    constructor() {
        super();
        this.index = null;
        this.isLoading = false;
    }

    isSubpage() {
        const path = window.location.pathname;
        return /\/docs\/[^\/]+\//.test(path) || (!path.endsWith('/docs/') && path.split('/docs/')[1]?.length > 0 && path.split('/docs/')[1].includes('/'));
    }

    connectedCallback() {
        this.style.display = 'contents';

        const isMobile = window.matchMedia('(pointer: coarse)').matches;
        const placeholderText = isMobile ? 'Search guides...' : "Search guides... (press '/' to focus)";
        const kbdContent = isMobile ? '' : '/';

        this.innerHTML = /*html*/ `
            <div class="docs-search-wrapper">
            <div class="search-input-container">
                <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input type="search" class="search-input" placeholder="${placeholderText}" aria-label="Search guides" autocomplete="off" />
                <kbd class="search-kbd">${kbdContent}</kbd>
            </div>
            <div class="search-dropdown"></div>
            </div>
        `;

        this.setupSearch();
    }

    async loadIndex() {
        if (this.index || this.isLoading) return;
        this.isLoading = true;

        try {
            const basePath = this.isSubpage() ? '../' : '';
            const response = await fetch(`${basePath}search-index.json`);
            if (response.ok) {
                this.index = await response.json();
            }
        } catch (e) {
            console.error('Failed to load search index:', e);
        } finally {
            this.isLoading = false;
        }
    }

    setupSearch() {
        const input = this.querySelector('.search-input');
        const dropdown = this.querySelector('.search-dropdown');
        let selectedIndex = -1;

        if (!input || !dropdown) return;

        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== input && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                input.focus();
            }
        });

        input.addEventListener('focus', () => {
            this.loadIndex();
            if (input.value.trim().length > 0) {
                dropdown.style.display = 'block';
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.contains(e.target)) {
                dropdown.style.display = 'none';
                selectedIndex = -1;
            }
        });

        input.addEventListener('input', () => {
            const query = input.value.trim().toLowerCase();
            if (!query) {
                dropdown.style.display = 'none';
                dropdown.innerHTML = '';
                selectedIndex = -1;
                return;
            }

            if (!this.index) {
                dropdown.innerHTML = '<div class="search-status">Loading search...</div>';
                dropdown.style.display = 'block';
                return;
            }

            const results = this.index
                .map(item => {
                    const titleLower = item.title.toLowerCase();
                    const category = item.category || 'Guides';
                    const categoryLower = category.toLowerCase();

                    let score = 0;
                    if (titleLower === query) {
                        score += 100;
                    } else if (titleLower.startsWith(query)) {
                        score += 80;
                    } else if (titleLower.includes(query)) {
                        score += 50;
                    } else if (stemMatch(item.title, query)) {
                        score += 35;
                    }

                    if (categoryLower.includes(query)) {
                        score += 20;
                    }
                    if (item.headings.some(h => h.toLowerCase().includes(query))) {
                        score += 10;
                    } else if (item.headings.some(h => stemMatch(h, query))) {
                        score += 6;
                    }
                    if (item.excerpt.toLowerCase().includes(query)) {
                        score += 5;
                    } else if (item.excerpt.toLowerCase().includes(query) || stemMatch(item.excerpt, query)) {
                        score += 3;
                    }
                    return { item, score };
                })
                .filter(res => res.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(res => res.item);

            const basePath = this.isSubpage() ? '../' : '';
            let html = '';
            if (results.length === 0) {
                html += '<div class="search-status">No results found</div>';
            } else {
                html += results.map((item, idx) => {
                    const matchingHeadings = item.headings
                        .filter(h => h.toLowerCase().includes(query))
                        .slice(0, 2);

                    const headingSnippet = matchingHeadings.length > 0
                        ? `<div class="result-heading-match">Matches: ${matchingHeadings.map(h => `<span class="heading-tag">${h}</span>`).join(', ')}</div>`
                        : '';

                    return `
                        <a href="${basePath}${item.path}" class="search-result-item" data-index="${idx}">
                            <div class="result-title">${item.title}</div>
                            <div class="result-category">${item.category || 'Guides'}</div>
                            <div class="result-excerpt">${item.excerpt}</div>
                            ${headingSnippet}
                        </a>
                    `;
                }).join('');
            }

            html += /*html*/ `
                <a href="${basePath}list.html?q=${encodeURIComponent(query)}" class="search-result-item full-search-row" data-index="${results.length}">
                    <div class="result-title">Full Search</div>
                    <div class="result-excerpt">See all results matching "${query}"</div>
                </a>
            `;
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
            selectedIndex = -1;
        });

        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.search-result-item');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % items.length;
                this.updateSelection(items, selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                this.updateSelection(items, selectedIndex);
            } else if (e.key === 'Enter') {
                if (selectedIndex >= 0 && selectedIndex < items.length) {
                    e.preventDefault();
                    items[selectedIndex].click();
                }
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
                selectedIndex = -1;
                input.blur();
            }
        });
    }

    updateSelection(items, index) {
        items.forEach((item, idx) => {
            if (idx === index) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }
}

class DocsGrid extends HTMLElement {
    connectedCallback() {
        this.style.display = 'contents';
        this.render();
    }
    async render() {
        const isSubpage = /\/docs\/[^\/]+\//.test(window.location.pathname);
        const basePath = isSubpage ? '../' : '';
        try {
            const response = await fetch(`${basePath}search-index.json`);
            if (!response.ok) throw new Error('Failed to load search-index.json');
            let items = await response.json();

            const idsAttr = this.getAttribute('ids');
            if (idsAttr) {
                const allowedIds = idsAttr.split(',').map(id => id.trim().toLowerCase());
                items = items
                    .filter(item => {
                        const docId = item.id || item.path.split('/')[0];
                        return allowedIds.includes(docId.toLowerCase());
                    })
                    .sort((a, b) => {
                        const idA = (a.id || a.path.split('/')[0]).toLowerCase();
                        const idB = (b.id || b.path.split('/')[0]).toLowerCase();
                        return allowedIds.indexOf(idA) - allowedIds.indexOf(idB);
                    });
            }

            const titleEl = this.previousElementSibling;
            if (!items || items.length === 0) {
                this.innerHTML = '';
                if (titleEl && titleEl.classList.contains('docs-categories-title')) {
                    titleEl.style.display = 'none';
                }
                return;
            }

            if (titleEl && titleEl.classList.contains('docs-categories-title')) {
                titleEl.style.display = '';
            }

            this.innerHTML = `
                <div class="docs-grid">
                    ${items.map(item => `
                        <a href="${basePath}${item.path}" class="docs-card">
                            <div class="docs-card-category">${item.category || 'Guides'}</div>
                            <h3 class="docs-card-title">${item.title}</h3>
                            <p class="docs-card-desc">${item.excerpt}</p>
                            <span class="docs-card-link">
                                Read Guide
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                    <polyline points="12 5 19 12 12 19"></polyline>
                                </svg>
                            </span>
                        </a>
                    `).join('')}
                </div>
            `;
        } catch (e) {
            this.innerHTML = `<div class="error">Failed to load guides.</div>`;
            console.error(e);
        }
    }
}

class DocsFooter extends HTMLElement {
    isSubpage() {
        const path = window.location.pathname;
        return /\/docs\/[^\/]+\//.test(path) || (!path.endsWith('/docs/') && path.split('/docs/')[1]?.length > 0 && path.split('/docs/')[1].includes('/'));
    }

    connectedCallback() {
        const basePath = this.isSubpage() ? '../' : '';
        fetch(`${basePath}docs-config.json`)
            .then(r => r.ok ? r.json() : null)
            .then(config => {
                this.render(config || {});
            })
            .catch(() => {
                this.render({});
            });
    }

    render(config) {
        const basePath = this.isSubpage() ? '../' : '';
        const projectName = config.projectName || 'Help Center';
        const currentYear = new Date().getFullYear();

        let footerLinks = [];
        const linksAttr = this.getAttribute('links');
        if (linksAttr) {
            try {
                footerLinks = JSON.parse(linksAttr);
            } catch (e) {
                console.error('Failed to parse links attribute on docs-footer:', e);
            }
        } else if (config.footerLinks) {
            footerLinks = config.footerLinks;
        }

        const linksHtml = footerLinks.map(link => {
            let href = link.href;
            if (this.isSubpage() && (href.startsWith('./') || href.startsWith('../'))) {
                href = basePath + href;
            }
            return `<a href="${href}" class="footer-link" ${link.id ? `id="footer-link-${link.id}"` : ''}>${link.title}</a>`;
        }).join('');

        this.innerHTML = /*html*/ `
            <footer class="app-footer">
                <div class="footer-content">
                    <p class="footer-copyright">
                        &copy; ${currentYear} ${projectName}
                    </p>
                    ${footerLinks.length > 0 ? `
                    <div class="footer-nav-links">
                        ${linksHtml}
                    </div>
                    ` : ''}
                    <div class="footer-theme-selector">
                        <button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme">
                            <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="5"></circle>
                                <line x1="12" y1="1" x2="12" y2="3"></line>
                                <line x1="12" y1="21" x2="12" y2="23"></line>
                                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                                <line x1="1" y1="12" x2="3" y2="12"></line>
                                <line x1="21" y1="12" x2="23" y2="12"></line>
                                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                            </svg>
                            <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                                stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                            </svg>
                            <span id="theme-status" class="theme-status"></span>
                        </button>
                    </div>
                </div>
            </footer>
        `;

        this.initTheme();
    }

    initTheme() {
        const themeToggle = this.querySelector('#theme-toggle');
        const themeStatus = this.querySelector('#theme-status');
        let themeStatusTimeout;

        function showThemeStatus(text) {
            if (!themeStatus) return;
            themeStatus.textContent = text;
            themeStatus.classList.add('visible');
            clearTimeout(themeStatusTimeout);
            themeStatusTimeout = setTimeout(() => { themeStatus.classList.remove('visible'); }, 2000);
        }

        function applyTheme(resolved, isSystem) {
            document.documentElement.setAttribute('data-theme', resolved);
            if (isSystem) {
                document.documentElement.setAttribute('data-theme-mode', 'system');
                localStorage.removeItem('theme');
            } else {
                document.documentElement.removeAttribute('data-theme-mode');
                localStorage.setItem('theme', resolved);
            }
        }

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme');
                const target = current === 'dark' ? 'light' : 'dark';
                const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                const systemTheme = systemPrefersDark ? 'dark' : 'light';
                const isSystem = target === systemTheme;

                applyTheme(target, isSystem);
                showThemeStatus(isSystem ? `System (${target === 'light' ? 'Light' : 'Dark'})` : target === 'light' ? 'Light Theme' : 'Dark Theme');
            });
        }

        // System theme change listener
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            }
        });
    }
}

customElements.define('docs-header', DocsHeader);
customElements.define('docs-sidebar', DocsSidebar);
customElements.define('docs-anchor-helper', DocsAnchorHelper);
customElements.define('docs-search', DocsSearch);
customElements.define('docs-grid', DocsGrid);
customElements.define('docs-footer', DocsFooter);
