# IndicOCR Studio v2

> **Zero-Server, Browser-Native OCR Platform for Indian Regional Languages & Multilingual Documents**

IndicOCR Studio v2 is a modern, high-performance web application that performs Optical Character Recognition (OCR), document layout reconstruction, and orthographic validation directly inside the web browser.

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

## 🚀 Live Demo / GitHub Pages Deployment

This project is built with vanilla web technologies (HTML5, CSS3, ES6 JavaScript) and has **no build step** or backend server requirements. It runs seamlessly on **GitHub Pages**.

### Deploying to GitHub Pages:

1. **Push this repository to GitHub**:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO_NAME>.git
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
     https://<YOUR_USERNAME>.github.io/<YOUR_REPO_NAME>/
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
