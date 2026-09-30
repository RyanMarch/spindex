import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_DIR = path.join(__dirname, '../public/docs');
const OUTPUT_FILE = path.join(DOCS_DIR, 'search-index.json');

// Load config to dynamically strip project name suffixes
const configPath = path.join(DOCS_DIR, 'docs-config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
const projectName = config.projectName || 'Spindex';
const baseUrl = (config.baseUrl || 'https://spindex.ryanmarch.me').replace(/\/$/, '');
const OG_IMAGE_URL = `${baseUrl}/assets/apple-touch-icon.png`;

// Helper to decode HTML entities
function unescapeHtml(text) {
    return (text || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&apos;/g, "'");
}

// Helper to strip HTML tags, unescape entities, and clean up whitespace
function cleanText(text) {
    return unescapeHtml(text)
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/\s+/g, ' ')    // Normalize spaces
        .trim();
}

// Removes any previously-written OG block regardless of formatting
const OG_BLOCK_PATTERN = /[ \t]*<meta property="og:type"[\s\S]*?<meta property="og:image:height"[^>]*>\n?/;

/**
 * Keeps each doc page's OG meta tags in sync with its own title, description, and canonical URL.
 */
function syncOgTags(filePath, { canonicalUrl, ogType }) {
    let html = fs.readFileSync(filePath, 'utf-8');

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : projectName;

    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
                       html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
    const description = descMatch ? descMatch[1].trim() : '';

    const ogBlock = `<meta property="og:type" content="${ogType}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${OG_IMAGE_URL}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
`;

    html = html.replace(OG_BLOCK_PATTERN, '');

    const anchor = '<!-- Docs Style Sheet -->';
    if (html.includes(anchor)) {
        html = html.replace(anchor, `${ogBlock}\n    ${anchor}`);
    } else {
        console.warn(`Skipped OG tag sync for ${filePath}: no "${anchor}" anchor found.`);
        return;
    }

    fs.writeFileSync(filePath, html, 'utf-8');
}

function syncAllOgTags() {
    syncOgTags(path.join(DOCS_DIR, 'index.html'), {
        canonicalUrl: `${baseUrl}/docs/`,
        ogType: 'website',
    });
    syncOgTags(path.join(DOCS_DIR, 'list.html'), {
        canonicalUrl: `${baseUrl}/docs/list.html`,
        ogType: 'website',
    });

    for (const file of fs.readdirSync(DOCS_DIR)) {
        const fullPath = path.join(DOCS_DIR, file);
        if (!fs.statSync(fullPath).isDirectory()) continue;
        const indexPath = path.join(fullPath, 'index.html');
        if (!fs.existsSync(indexPath)) continue;
        syncOgTags(indexPath, {
            canonicalUrl: `${baseUrl}/docs/${file}/`,
            ogType: 'article',
        });
    }

    console.log('Synced OG meta tags across all docs pages.');
}

function generateIndex() {
    const entries = [];
    const files = fs.readdirSync(DOCS_DIR);

    // Escape special characters in project name for regex safety
    const safeProjectName = projectName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const stripProjectRegex = new RegExp(`\\s*[—\\|\\-]\\s*${safeProjectName}\\s*(Docs)?`, 'i');

    for (const file of files) {
        const fullPath = path.join(DOCS_DIR, file);
        if (!fs.statSync(fullPath).isDirectory()) continue;

        const indexPath = path.join(fullPath, 'index.html');
        if (!fs.existsSync(indexPath)) continue;

        const html = fs.readFileSync(indexPath, 'utf-8');

        // Extract Title
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        let title = titleMatch ? titleMatch[1] : '';
        // Clean title suffix and unescape entities
        title = unescapeHtml(title.replace(stripProjectRegex, '').replace(/\s*Guide/i, '').trim());

        // Extract Excerpt (Meta Description)
        const excerptMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
                             html.match(/<meta\s+content="([^"]+)"\s+name="description"/i);
        const excerpt = unescapeHtml(excerptMatch ? excerptMatch[1] : '');

        // Extract Category
        const categoryMatch = html.match(/<meta\s+name="category"\s+content="([^"]+)"/i) ||
                               html.match(/<meta\s+content="([^"]+)"\s+name="category"/i);
        const category = unescapeHtml(categoryMatch ? categoryMatch[1] : 'Guides');

        // Extract Doc ID (fallback to folder name)
        const idMatch = html.match(/<meta\s+name="doc-id"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+content="([^"]+)"\s+name="doc-id"/i);
        const id = idMatch ? idMatch[1] : file;

        // Extract Headings (H2 and H3)
        const headings = [];
        const headingRegex = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
        let match;
        while ((match = headingRegex.exec(html)) !== null) {
            const rawHeadingText = match[2];
            const cleanHeading = cleanText(rawHeadingText.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, ''));
            if (cleanHeading && cleanHeading !== 'Table of Contents' && cleanHeading !== 'See Also' && cleanHeading !== 'See More' && !headings.includes(cleanHeading)) {
                headings.push(cleanHeading);
            }
        }

        const finalHeadings = headings.filter(h => h.toLowerCase() !== 'overview');

        entries.push({
            id,
            title,
            path: `${file}/`,
            category,
            headings: ['Overview', ...finalHeadings],
            excerpt,
            lastUpdated: new Date().toISOString().split('T')[0]
        });
    }

    // Sort entries by category priority, then title
    const categoryOrder = { 'Basics': 1, 'Exploring': 2, 'Features': 3, 'Guides': 4 };
    entries.sort((a, b) => {
        const orderA = categoryOrder[a.category] || 99;
        const orderB = categoryOrder[b.category] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return a.title.localeCompare(b.title);
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(entries, null, 2), 'utf-8');
    console.log(`Successfully generated docs search-index.json at ${OUTPUT_FILE}`);
}

generateIndex();
syncAllOgTags();
