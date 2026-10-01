import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configurations dynamically from docs-config.json
const configPath = path.join(__dirname, '../public/docs/docs-config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
const projectName = config.projectName || 'Spindex';
const baseUrl = (config.baseUrl || 'https://spindex.ryanmarch.me').replace(/\/$/, '');

const defaultFontsUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';
const fontsConfig = config.googleFontsUrl !== undefined ? config.googleFontsUrl : false;
let fontsHtml = '';
if (fontsConfig) {
    const url = typeof fontsConfig === 'string' ? fontsConfig : defaultFontsUrl;
    fontsHtml = `<!-- Preconnect Fonts -->
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="${url}" rel="stylesheet">`;
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const DOCS_DIR = path.join(__dirname, '../public/docs');

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start
        .replace(/-+$/, '');            // Trim - from end
}

async function main() {
    console.log('\n====================================');
    console.log(`    Create a New ${projectName} Guide  `);
    console.log('====================================\n');

    let title = '';
    while (!title.trim()) {
        title = await askQuestion('Document Title (for example: Digging the Crate): ');
    }

    const folderSlug = slugify(title);
    const targetDir = path.join(DOCS_DIR, folderSlug);

    if (fs.existsSync(targetDir)) {
        console.error(`\nError: Directory already exists at public/docs/${folderSlug}`);
        rl.close();
        return;
    }

    const category = (await askQuestion('Category (Basics / Exploring / Features / [Guides]): ')).trim() || 'Guides';
    const description = (await askQuestion('Description / Meta Description: ')).trim() || 'No description provided.';

    // HTML template content
    const htmlContent = /*html*/ `<!DOCTYPE html>
<html lang="en" translate="no">

<head>
    <meta charset="UTF-8">
    <link rel="icon" type="image/svg+xml" href="../../assets/brand/spindex-mark.svg">
    <link rel="apple-touch-icon" sizes="180x180" href="../../assets/apple-touch-icon.png">
    <link rel="manifest" href="../../manifest.webmanifest">
    <meta name="apple-mobile-web-app-title" content="${projectName}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="google" content="notranslate">
    <script src="../docs-theme-loader.js"></script>

    ${fontsHtml}

    <title>${title} | ${projectName} Docs</title>
    <meta name="description" content="${description.replace(/"/g, '&quot;')}">
    <meta name="category" content="${category}">
    <meta name="doc-id" content="${folderSlug}">
    <link rel="canonical" href="${baseUrl}/docs/${folderSlug}/">

    <!-- Docs Style Sheet -->
    <link rel="stylesheet" href="../style.css">
    <script src="../docs-components.js" type="module"></script>
</head>

<body class="user-docs-page">
    <div class="app-container">
        <!-- Mobile Navigation Overlay -->
        <div id="mobile-overlay" class="mobile-overlay"></div>

        <main class="page-container-sidebar user-docs">
            <!-- Sidebar Navigation -->
            <docs-sidebar></docs-sidebar>

            <!-- Right-side Content & Header Wrapper -->
            <div class="page-content-wrapper">
                <docs-header></docs-header>

                <!-- Content Area -->
                <docs-anchor-helper>
                    <section class="page-content" aria-label="${title} Content">

                        <!-- Overview -->
                        <article id="overview" class="doc-section">
                            <h1>${title}</h1>
                            <p class="lead">
                                ${description}
                            </p>
                        </article>

                        <!-- Table of Contents -->
                        <docs-table-of-contents></docs-table-of-contents>

                        <hr class="section-divider">

                        <!-- Section 1 -->
                        <article id="section-1" class="doc-section">
                            <h2>First Section</h2>
                            <p>
                                Add details about the first section here.
                            </p>
                        </article>

                    </section>
                </docs-anchor-helper>
            </div>
        </main>

        <!-- Footer -->
        <docs-footer></docs-footer>

        <!-- Lightbox Modal -->
        <div id="lightbox-modal" class="lightbox-modal" aria-hidden="true" role="dialog" aria-label="Image Viewer">
            <button class="lightbox-close" aria-label="Close image viewer">&times;</button>
            <img class="lightbox-content" id="lightbox-img" alt="">
            <div class="lightbox-caption" id="lightbox-caption"></div>
        </div>
    </div>
</body>

</html>
`;

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'index.html'), htmlContent, 'utf-8');

    console.log(`\nCreated docs folder: public/docs/${folderSlug}`);
    console.log(`Created docs page:   public/docs/${folderSlug}/index.html`);

    // Rebuild index
    try {
        console.log('Rebuilding search index...');
        execSync('node scripts/generate-docs-index.js', { stdio: 'inherit' });
    } catch (err) {
        console.error('Failed to rebuild search index:', err);
    }

    rl.close();
}

main().catch(err => {
    console.error(err);
    rl.close();
});
