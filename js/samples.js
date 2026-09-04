'use strict';

/**
 * samples.js — Built-in Indic Regional Language Sample Scans
 *
 * Provides ready-to-process scanned documents:
 *   1. Bilingual Court Order (Hindi/English Legal Case File)
 *   2. Land Revenue Record (UP Khatauni / Khasra Land Title)
 *   3. Classical Sanskrit Manuscript (Bhagavad Gita Verse & Commentary)
 *   4. Bengali Administrative Gazette (Land Reform Circular)
 *
 * Each sample generates a high-resolution canvas scan with authentic stamps,
 * typography, and layout, returning a real browser File object ready for OCR.
 *
 * Exposes: window.OCRStudio.Samples
 */

window.OCRStudio = window.OCRStudio || {};

window.OCRStudio.Samples = (function () {

  var SAMPLE_DEFS = [
    {
      id: 'court_order',
      title: 'Bilingual Court Order',
      filename: 'sample_high_court_order.png',
      language: 'hin+eng',
      scriptName: 'Devanagari + English',
      badge: 'Legal / Court',
      icon: 'court',
      description: 'Criminal Case No. 412/2024 u/s 420 IPC, bilingual judicial order with seals and citations.',
      render: renderCourtOrder
    },
    {
      id: 'land_record',
      title: 'Land Record (Khatauni)',
      filename: 'sample_land_record_khatauni.png',
      language: 'hin+eng',
      scriptName: 'Devanagari (Revenue)',
      badge: 'Revenue / Land',
      icon: 'scroll',
      description: 'UP Revenue Board record (खतौनी), khasra plot numbers, area in hectares, patwari remarks.',
      render: renderLandRecord
    },
    {
      id: 'sanskrit_manuscript',
      title: 'Sanskrit Manuscript',
      filename: 'sample_sanskrit_manuscript.png',
      language: 'san',
      scriptName: 'Sanskrit (Devanagari)',
      badge: 'Historical / Archive',
      icon: 'feather',
      description: 'Shrimad Bhagavad Gita Shlokas with classical ligatures, danda delimiters, and commentary.',
      render: renderSanskritManuscript
    },
    {
      id: 'bengali_gazette',
      title: 'Bengali Gazette Notice',
      filename: 'sample_bengali_gazette.png',
      language: 'ben+eng',
      scriptName: 'Bengali + English',
      badge: 'Govt Circular',
      icon: 'newspaper',
      description: 'West Bengal Land Reforms circular with official notification numbers and Bengali orthography.',
      render: renderBengaliGazette
    }
  ];

  // ---------------------------------------------------------------------------
  // Canvas Rendering Utilities
  // ---------------------------------------------------------------------------

  function createBaseCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width || 1600;
    canvas.height = height || 2200;
    var ctx = canvas.getContext('2d');

    // Scanned paper texture: off-white antique parchment tone
    ctx.fillStyle = '#faf8f2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle aging vignetting / noise
    var grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 400,
      canvas.width / 2, canvas.height / 2, 1200
    );
    grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    grad.addColorStop(1, 'rgba(215, 205, 185, 0.25)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Marginal border line
    ctx.strokeStyle = '#d5cbb8';
    ctx.lineWidth = 1;
    ctx.strokeRect(60, 60, canvas.width - 120, canvas.height - 120);

    return { canvas: canvas, ctx: ctx };
  }

  // 1. Bilingual Court Order (Hindi + English)
  function renderCourtOrder() {
    var base = createBaseCanvas(1600, 2200);
    var ctx = base.ctx;
    var w = base.canvas.width;

    // Court Header Seal
    ctx.strokeStyle = '#2b3a4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(100, 90, w - 200, 160);

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px "Kohinoor Devanagari", "Noto Sans Devanagari", "Mangal", sans-serif';
    ctx.fillText('न्यायालय मुख्य न्यायिक मजिस्ट्रेट, लखनऊ (उत्तर प्रदेश)', w / 2, 145);

    ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#374151';
    ctx.fillText('COURT OF CHIEF JUDICIAL MAGISTRATE, LUCKNOW', w / 2, 185);

    ctx.font = 'italic 18px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('CRIMINAL MISC. PETITION NO. 412 OF 2024', w / 2, 220);

    // Case Details Table / Block
    ctx.textAlign = 'left';
    ctx.font = 'bold 24px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillStyle = '#111827';
    ctx.fillText('अभियोग संख्या: 412/2024', 120, 310);
    ctx.fillText('थाना: हजरतगंज, जनपद: लखनऊ', 120, 350);
    ctx.fillText('धारा: 420, 467, 468, 471 IPC अंतर्गत आदेश', 120, 390);

    // Divider
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(120, 420);
    ctx.lineTo(w - 120, 420);
    ctx.stroke();

    // Body Paragraphs (Bilingual)
    ctx.font = '22px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillStyle = '#1f2937';

    var lines = [
      'आदेश दिनांक: 04 सितंबर 2026',
      '',
      'प्रस्तुत प्रकरण में वादी पक्ष द्वारा धारा 156(3) दंड प्रक्रिया संहिता के अंतर्गत प्रार्थना पत्र प्रस्तुत',
      'किया गया है। पत्रावली पर उपलब्ध साक्ष्यों एवं प्रथम सूचना रिपोर्ट (FIR No. 208/2024) का सम्यक',
      'अवलोकन किया गया। विपक्षीगण के विरुद्ध वित्तीय अनियमितताओं एवं अभिलेखों में कूटकरण के गंभीर',
      'आरोप परिलक्षित होते हैं।',
      '',
      'The Investigating Officer (I.O.) is hereby directed to conduct a fair and expeditious',
      'investigation in accordance with Section 173 Cr.P.C. and submit the status report',
      'before this Court within four weeks from today.',
      '',
      'न्यायालय द्वारा अंतरिम आदेश पारित करते हुए निर्देशित किया जाता है कि वादी की संपत्ति पर किसी भी',
      'प्रकार का तृतीय पक्ष हित (third-party interest) आगामी सुनवाई तिथि तक सृजित न किया जाए।',
      'विपक्षीगण को नोटिस जारी किए जाएं।',
      '',
      'अगली सुनवाई तिथि नियत: 15 अक्टूबर 2026',
      'पत्रावली वास्ते साक्ष्य एवं आपत्ति पेश हो।'
    ];

    var y = 470;
    for (var i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 120, y);
      y += 38;
    }

    // Official Seal Simulation (Round stamp)
    ctx.strokeStyle = 'rgba(30, 64, 175, 0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w - 280, 1500, 75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = 'rgba(30, 64, 175, 0.6)';
    ctx.textAlign = 'center';
    ctx.fillText('SEAL OF THE COURT', w - 280, 1495);
    ctx.fillText('LUCKNOW', w - 280, 1515);

    // Signature Block
    ctx.textAlign = 'right';
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 22px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText('(मुख्य न्यायिक मजिस्ट्रेट)', w - 160, 1700);
    ctx.font = '18px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Chief Judicial Magistrate, Lucknow', w - 160, 1730);

    return base.canvas;
  }

  // 2. Land Record (UP Khatauni / Khasra)
  function renderLandRecord() {
    var base = createBaseCanvas(1600, 2200);
    var ctx = base.ctx;
    var w = base.canvas.width;

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText('उत्तर प्रदेश भूलेख — उद्धरण खतौनी (अभिलेख)', w / 2, 130);

    ctx.font = '22px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillStyle = '#4b5563';
    ctx.fillText('राजस्व परिषद, उत्तर प्रदेश शासन — कम्प्यूटरीकृत भूमि अभिलेख', w / 2, 170);

    // Location Metadata Table
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 22px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText('जनपद: लखनऊ', 120, 250);
    ctx.fillText('तहसील: सदर', 550, 250);
    ctx.fillText('परगना: बिजनौर', 950, 250);
    ctx.fillText('ग्राम: रामपुर (कोड: 142058)', 120, 295);
    ctx.fillText('फसली वर्ष: 1430–1435', 550, 295);
    ctx.fillText('खाता संख्या: 00184', 950, 295);

    // Table Grid
    var startY = 360;
    var rowH = 65;
    var cols = [100, 420, 750, 1050, 1300, 1500];

    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1.5;

    // Header row background
    ctx.fillStyle = '#eae5d8';
    ctx.fillRect(cols[0], startY, cols[5] - cols[0], rowH);

    // Draw header text
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 20px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText('खातेदार का नाम / पिता', cols[0] + 15, startY + 40);
    ctx.fillText('निवास स्थान', cols[1] + 15, startY + 40);
    ctx.fillText('खसरा संख्या', cols[2] + 15, startY + 40);
    ctx.fillText('क्षेत्रफल (हे.)', cols[3] + 15, startY + 40);
    ctx.fillText('मालगुजारी (रु)', cols[4] + 15, startY + 40);

    // Table rows
    var rowData = [
      ['रामप्रसाद सुत स्व. शिवगोपाल', 'ग्राम रामपुर', '412/1 ख', '1.4280', '48.50'],
      ['श्रीमती कौशल्या देवी पत्नी रामप्रसाद', 'ग्राम रामपुर', '412/2', '0.8540', '28.00'],
      ['सुरेश कुमार सुत रामप्रसाद', 'लखनऊ नगर', '518 क', '2.1400', '72.25'],
      ['महेश चंद्र सुत रामप्रसाद', 'ग्राम रामपुर', '519/1', '0.6250', '21.00'],
      ['गंगादीन सुत रामप्रसाद (नाबालिग)', 'ग्राम रामपुर', '624 ख', '1.1800', '39.80']
    ];

    ctx.font = '20px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';

    for (var r = 0; r < rowData.length; r++) {
      var y = startY + (r + 1) * rowH;
      for (var c = 0; c < rowData[r].length; c++) {
        ctx.fillText(rowData[r][c], cols[c] + 15, y + 40);
      }
    }

    // Grid lines
    var totalRows = rowData.length + 1;
    for (var i = 0; i <= totalRows; i++) {
      var gy = startY + i * rowH;
      ctx.beginPath();
      ctx.moveTo(cols[0], gy);
      ctx.lineTo(cols[5], gy);
      ctx.stroke();
    }
    for (var j = 0; j < cols.length; j++) {
      ctx.beginPath();
      ctx.moveTo(cols[j], startY);
      ctx.lineTo(cols[j], startY + totalRows * rowH);
      ctx.stroke();
    }

    // Remarks Section
    var remY = startY + totalRows * rowH + 60;
    ctx.font = 'bold 22px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText('राजस्व निरीक्षक एवं लेखपाल आख्या / आदेश:', 100, remY);
    ctx.font = '20px "Kohinoor Devanagari", "Noto Sans Devanagari", sans-serif';
    ctx.fillText('१. आदेश तहसीलदार सदर पत्रांक 512/ना.वा. दिनांक 12.03.2023 के अनुसार वरासत दर्ज की गई।', 120, remY + 45);
    ctx.fillText('२. बंधक: खाता संख्या 00184 खसरा 412/1 पर स्टेट बैंक ऑफ इंडिया शाखा सदर का 5,00,000/- रु ऋण भारित है।', 120, remY + 85);
    ctx.fillText('३. प्रमाणित किया जाता है कि उपरोक्त विवरण भूलेख पोर्टल की अद्यतन खतौनी के अनुसार सत्य है।', 120, remY + 125);

    // Official Stamp
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(100, remY + 180, 280, 100);
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = 'rgba(5, 150, 105, 0.7)';
    ctx.fillText('राजस्व अभिलेखागार', 140, remY + 220);
    ctx.fillText('डिजिटल हस्ताक्षर सत्यापित', 140, remY + 250);

    return base.canvas;
  }

  // 3. Classical Sanskrit Manuscript
  function renderSanskritManuscript() {
    var base = createBaseCanvas(1600, 2200);
    var ctx = base.ctx;
    var w = base.canvas.width;

    ctx.fillStyle = '#451a03';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px "Kohinoor Devanagari", "Noto Sans Devanagari", serif';
    ctx.fillText('॥ श्रीमद्भगवद्गीता ॥', w / 2, 140);

    ctx.font = '26px "Kohinoor Devanagari", "Noto Sans Devanagari", serif';
    ctx.fillStyle = '#78350f';
    ctx.fillText('अथ द्वितीयोऽध्यायः — सांख्ययोगः', w / 2, 195);

    // Decorative Sanskrit horizontal divider
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(350, 230);
    ctx.lineTo(w - 350, 230);
    ctx.stroke();

    ctx.font = 'bold 28px "Kohinoor Devanagari", "Noto Sans Devanagari", serif';
    ctx.fillStyle = '#111827';
    ctx.fillText('कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।', w / 2, 330);
    ctx.fillText('मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥ ४७॥', w / 2, 385);

    ctx.fillText('योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय।', w / 2, 480);
    ctx.fillText('सिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते॥ ४८॥', w / 2, 535);

    // Commentary Section
    ctx.textAlign = 'left';
    ctx.font = 'bold 24px "Kohinoor Devanagari", "Noto Sans Devanagari", serif';
    ctx.fillStyle = '#78350f';
    ctx.fillText('शाङ्करभाष्यम् एवं पदच्छेदः:', 120, 640);

    var bhashya = [
      'कर्मणि एव अधिकारः ते, न फलेषु कदाचित् अपि। फलतृष्णा मा भूत्।',
      'यदि कर्मफलतृष्णायुक्तः सन् कर्माणि करोषि, तर्हि कर्मफलस्य हेतुः त्वं भवेः।',
      'अतः कर्मफलहेतुः मा भूः, अकर्मणि च अकरणे ते सङ्गः आसक्तिः मा अस्तु।',
      '',
      'समत्वं योग उच्यते — सिद्धिः असिद्धिः च, तयोः तुल्यबुद्धित्वं समत्वम्।',
      'जयपराजययोः लाभअलाभयोः सुखदुःखयोः समबुद्धिः भूत्वा स्वधर्मम् अनुतिष्ठ।'
    ];

    ctx.font = '22px "Kohinoor Devanagari", "Noto Sans Devanagari", serif';
    ctx.fillStyle = '#1f2937';
    var cy = 700;
    for (var k = 0; k < bhashya.length; k++) {
      ctx.fillText(bhashya[k], 140, cy);
      cy += 42;
    }

    return base.canvas;
  }

  // 4. Bengali Administrative Gazette
  function renderBengaliGazette() {
    var base = createBaseCanvas(1600, 2200);
    var ctx = base.ctx;
    var w = base.canvas.width;

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px "Kohinoor Bangla", "Noto Sans Bengali", sans-serif';
    ctx.fillText('পশ্চিমবঙ্গ সরকার', w / 2, 130);

    ctx.font = '24px "Kohinoor Bangla", "Noto Sans Bengali", sans-serif';
    ctx.fillStyle = '#374151';
    ctx.fillText('ভূমি ও ভূমি সংস্কার দপ্তর — মহাকরণ, কলকাতা', w / 2, 175);

    ctx.font = 'bold 20px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('GOVERNMENT OF WEST BENGAL — LAND & REFORMS DEPT', w / 2, 215);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 22px "Kohinoor Bangla", "Noto Sans Bengali", sans-serif';
    ctx.fillText('বিজ্ঞপ্তি নম্বর: ১৮৪/এলআর/২০২৬', 120, 310);
    ctx.fillText('তারিখ: ৪ সেপ্টেম্বর, ২০২৬', w - 400, 310);

    // Horizontal line
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(120, 340);
    ctx.lineTo(w - 120, 340);
    ctx.stroke();

    var benLines = [
      'বিষয়: ভূমি মিউটেশন ও রেকর্ড সংশোধন প্রক্রিয়া সহজীকরণ সংক্রান্ত আদেশ।',
      '',
      'এতদ্বারা সর্বসাধারণের অবগতির জন্য জানানো যাইতেছে যে, পশ্চিমবঙ্গ ভূমি সংস্কার আইন,',
      '১৯৫৫-এর ধারা ৫০ অনুযায়ী সমস্ত ব্লকের বিএলআরও (BL&LRO) অফিসগুলিতে নাগরিকগণের',
      'আবেদন দ্রুত নিষ্পত্তির নির্দেশ দেওয়া হইতেছে।',
      '',
      '১. উত্তরাধিকার সূত্রে প্রাপ্ত ভূমির ক্ষেত্রে ওয়ারিশান সনদ ও হাল খতিয়ান প্রাপ্তির পর',
      '   সাত কার্যদিবসের মধ্যে মিউটেশন সম্পন্ন করিতে হইবে।',
      '',
      '২. হস্তান্তরিত সম্পত্তির ক্ষেত্রে দলিল রেজিস্ট্রেশনের স্বয়ংক্রিয় তথ্যের ভিত্তিতে',
      '   ডিজিটাল রেকর্ড আপডেট নিশ্চিত করিতে হইবে।',
      '',
      '৩. রায়তের স্বার্থ রক্ষার্থে কোনো অনিয়ম পরিলক্ষিত হইলে অবিলম্বে মহকুমা শাসকের',
      '   নিকট আপিল দাখিল করা যাইবে।',
      '',
      'রাজ্যপালের আদেশানুসারে,',
      'সচিব, ভূমি ও ভূমি সংস্কার দপ্তর'
    ];

    ctx.font = '22px "Kohinoor Bangla", "Noto Sans Bengali", sans-serif';
    ctx.fillStyle = '#1f2937';
    var by = 400;
    for (var b = 0; b < benLines.length; b++) {
      ctx.fillText(benLines[b], 120, by);
      by += 40;
    }

    return base.canvas;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Convert a rendered canvas into a standard browser File object.
   * @param {string} sampleId
   * @returns {Promise<File>}
   */
  async function getSampleFile(sampleId) {
    var def = SAMPLE_DEFS.find(function (s) { return s.id === sampleId; });
    if (!def) def = SAMPLE_DEFS[0];

    var canvas = def.render();

    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('Failed to create sample blob'));
          return;
        }
        var file = new File([blob], def.filename, {
          type: 'image/png',
          lastModified: Date.now()
        });
        // Tag metadata for language auto-selection
        file._sampleLanguage = def.language;
        file._sampleId = def.id;
        resolve(file);
      }, 'image/png', 0.95);
    });
  }

  /**
   * Directly download a sample file to user's disk.
   * @param {string} sampleId
   */
  async function downloadSample(sampleId) {
    var file = await getSampleFile(sampleId);
    if (window.saveAs) {
      window.saveAs(file, file.name);
    } else {
      var url = URL.createObjectURL(file);
      var a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return {
    list: SAMPLE_DEFS,
    getSampleFile: getSampleFile,
    downloadSample: downloadSample
  };

})();
