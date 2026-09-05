# 📄 OCR Studio

> **Zero-Server, Browser-Native OCR Platform for Indian Regional Languages & Multilingual Documents**

[![Live Demo](https://img.shields.io/badge/🚀%20Live%20Demo-ocrstudio.pages.dev-blue?style=for-the-badge&logo=cloudflare)](https://ocrstudio.pages.dev)
[![GitHub](https://img.shields.io/badge/GitHub-akashydv23%2FOCR-black?style=for-the-badge&logo=github)](https://github.com/akashydv23/OCR)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

### 🌐 **Live Website Link:** [https://ocrstudio.pages.dev](https://ocrstudio.pages.dev)

> **📌 Note for Evaluators / Reviewers:**  
> The live production application is deployed and hosted on **Cloudflare Pages** at:  
> 👉 **[https://ocrstudio.pages.dev](https://ocrstudio.pages.dev)**  
> You can test document scanning, multi-language OCR, parallel multi-page processing, and DOCX/PDF export live directly in your browser without any setup!

---

## 🌟 Key Features

- **🔒 100% Client-Side Privacy (Zero Data Transmission)**: In standard mode, zero bytes leave your device. All image preprocessing, deskewing, binarization, layout detection, and OCR are processed locally via WebAssembly.
- **⚡ Dual-Engine Acceleration**:
  - **On-Device Mode**: Pure client-side Tesseract.js v5 WASM engine for complete offline operation.
  - **Fast AI Mode**: Multimodal transcription via Google **Gemini 3.6 Flash / Pro** (~1s/page) when an API key is linked.
- **✨ Instant Multi-Tier Language Auto-Detection**:
  - **Tier 1 (Digital PDFs - 2ms)**: Direct Unicode script classification on the PDF text layer.
  - **Tier 2 (Scanned PDFs / Images - 300ms)**: Fast AI multimodal script detection.
- **🎯 Strict Verbatim Transcription**:
  - Zero translation or transliteration.
  - Strict preservation of original language (English, Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Odia, Punjabi, Sanskrit, Urdu).
- **📑 Multi-Format Professional Export**:
  - **Searchable PDF**: Embedded 100% transparent text layer (`opacity: 0`) over original high-res imagery for `Cmd + F` search and text selection without visual artifacts.
  - **Word DOCX**: Structured headings, paragraphs, and page breaks.
  - **Plain TXT**: Clean UTF-8 text with page dividers.
  - **Canonical JSON**: Full audit metadata, word coordinates, reading order, and confidence scores.
- **📱 PWA & Offline Support**:
  - Service Worker cache-first architecture. Fully functional without an active internet connection after initial load.

---

## 🚀 Live Demo & Deployment

- **Live Production URL (Cloudflare Pages):** **[https://ocrstudio.pages.dev](https://ocrstudio.pages.dev)**
- **GitHub Repository:** **[https://github.com/akashydv23/OCR](https://github.com/akashydv23/OCR)**

This project is built with vanilla web technologies (HTML5, CSS3, ES6 JavaScript) and has **no build step** or backend server requirements. It can be deployed in seconds to **Cloudflare Pages**, **GitHub Pages**, or Vercel.

### Deploying to GitHub Pages:

1. **Push this repository to GitHub**:
   ```bash
   git remote add origin https://github.com/akashydv23/OCR.git
   git branch -M main
   git push -u origin main
   ```

2. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click **Settings** (tab at the top).
   - In the left sidebar, click **Pages**.
   - Under **Build and deployment** -> **Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` and folder `/ (root)`.
   - Click **Save**.

3. **Access Your Live Site**:
   - Within 1–2 minutes, your site will be live at:
     ```
     https://akashydv23.github.io/OCR/
     ```

---

## 💻 Local Development

Run any static HTTP server in the repository directory:

```bash
# Python 3
python3 -m http.server 8081

# Node.js (npx)
npx serve -l 8081

# PHP
php -S localhost:8081
```

Open `http://localhost:8081` in your browser.

---

## 🛠️ Architecture & Tech Stack

- **Frontend Core**: Vanilla JavaScript (no frameworks or bundlers required)
- **OCR Engine**: Tesseract.js v5 (WASM) + Google Gemini AI REST API
- **PDF Rendering**: PDF.js v3.11
- **PDF Generation**: pdf-lib v1.17.1 (Searchable PDF with invisible text layer)
- **DOCX Generation**: docx.js v9.7.1
- **Client Database**: Dexie.js v4 (IndexedDB for storing document pages and image blobs)
- **PWA**: Service Worker (`sw.js`) with cache-first asset caching

---

## 👨‍💻 Author & Maintainer

Crafted with ❤️ by **Akash Yadav**

---

## 📄 License

MIT License. Open-source and free for commercial and personal use.
