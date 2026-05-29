(function () {
  "use strict";

  var MAX_BYTES = 20 * 1024 * 1024;
  var ACCEPT_TYPES = {
    "image/jpeg": true,
    "image/png": true,
    "image/webp": true,
  };
  var ACCEPT_EXT = /\.(jpe?g|png|webp)$/i;

  var dropzone = document.getElementById("dropzone");
  var fileInput = document.getElementById("file-input");
  var qualityEl = document.getElementById("cmp-quality");
  var formatEl = document.getElementById("cmp-format");
  var maxWidthEl = document.getElementById("cmp-max-width");
  var maxHeightEl = document.getElementById("cmp-max-height");
  var formatNote = document.getElementById("format-note");
  var infoPanel = document.getElementById("info-panel");
  var infoName = document.getElementById("info-name");
  var infoOriginalSize = document.getElementById("info-original-size");
  var infoCompressedSize = document.getElementById("info-compressed-size");
  var infoRatio = document.getElementById("info-ratio");
  var infoDimensions = document.getElementById("info-dimensions");
  var previewOriginalEmpty = document.getElementById("preview-original-empty");
  var previewOriginal = document.getElementById("preview-original");
  var previewCompressedEmpty = document.getElementById("preview-compressed-empty");
  var previewCompressed = document.getElementById("preview-compressed");
  var btnPick = document.getElementById("btn-pick");
  var btnCompress = document.getElementById("btn-compress");
  var btnDownload = document.getElementById("btn-download");
  var btnClear = document.getElementById("btn-clear");
  var hintEl = document.getElementById("hint");

  var state = {
    file: null,
    originalUrl: "",
    compressedUrl: "",
    compressedBlob: null,
    outputMime: "",
    naturalWidth: 0,
    naturalHeight: 0,
    outputWidth: 0,
    outputHeight: 0,
    compressing: false,
  };

  function showHint(message, kind) {
    if (!message) {
      hintEl.hidden = true;
      hintEl.textContent = "";
      hintEl.className = "hint";
      return;
    }
    hintEl.hidden = false;
    hintEl.textContent = message;
    hintEl.className = "hint hint--" + (kind || "info");
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function formatRatio(original, compressed) {
    if (!original || !compressed) return "—";
    var pct = ((1 - compressed / original) * 100).toFixed(1);
    if (compressed > original) return "增大 " + Math.abs(pct) + "%";
    if (compressed === original) return "0%";
    return "减少 " + pct + "%";
  }

  function revokeUrl(url) {
    if (url) URL.revokeObjectURL(url);
  }

  function isAcceptedFile(file) {
    if (!file) return false;
    if (ACCEPT_TYPES[file.type]) return true;
    return ACCEPT_EXT.test(file.name || "");
  }

  function normalizeMimeFromFile(file) {
    if (file.type && ACCEPT_TYPES[file.type]) return file.type;
    var name = (file.name || "").toLowerCase();
    if (name.endsWith(".png")) return "image/png";
    if (name.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  }

  function getOutputMime(file) {
    var choice = formatEl.value;
    if (choice === "jpeg") return "image/jpeg";
    if (choice === "png") return "image/png";
    if (choice === "webp") return "image/webp";
    return normalizeMimeFromFile(file);
  }

  function getQuality() {
    var q = parseFloat(qualityEl.value);
    if (isNaN(q)) return 0.8;
    return Math.min(1, Math.max(0.1, q));
  }

  function parseOptionalPositive(input) {
    var raw = String(input.value || "").trim();
    if (!raw) return 0;
    var n = parseInt(raw, 10);
    return n > 0 ? n : 0;
  }

  function calcOutputSize(nw, nh, maxW, maxH) {
    var w = nw;
    var h = nh;
    if (maxW > 0 && w > maxW) {
      h = Math.round((h * maxW) / w);
      w = maxW;
    }
    if (maxH > 0 && h > maxH) {
      w = Math.round((w * maxH) / h);
      h = maxH;
    }
    return { width: Math.max(1, w), height: Math.max(1, h) };
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        resolve({ img: img, url: url });
      };
      img.onerror = function () {
        revokeUrl(url);
        reject(new Error("图片无法读取。"));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve) {
      if (mime === "image/png") {
        canvas.toBlob(resolve, mime);
        return;
      }
      canvas.toBlob(resolve, mime, quality);
    });
  }

  function extensionForMime(mime) {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg";
  }

  function buildDownloadName(file, mime) {
    var name = file.name || "image";
    var dot = name.lastIndexOf(".");
    var base = dot > 0 ? name.slice(0, dot) : name;
    return base + "-compressed." + extensionForMime(mime);
  }

  function resetCompressedPreview() {
    revokeUrl(state.compressedUrl);
    state.compressedUrl = "";
    state.compressedBlob = null;
    state.outputMime = "";
    previewCompressed.hidden = true;
    previewCompressed.removeAttribute("src");
    previewCompressedEmpty.hidden = false;
    infoCompressedSize.textContent = "—";
    infoRatio.textContent = "—";
    btnDownload.disabled = true;
  }

  function updateFormatNote() {
    var show =
      formatEl.value === "png" ||
      (formatEl.value === "original" && state.file && normalizeMimeFromFile(state.file) === "image/png");
    formatNote.hidden = !show;
  }

  function updateButtons() {
    btnCompress.disabled = !state.file || state.compressing;
  }

  function setOriginalPreview(url, w, h) {
    previewOriginal.src = url;
    previewOriginal.hidden = false;
    previewOriginalEmpty.hidden = true;
    infoDimensions.textContent = w + " × " + h;
  }

  function clearAll() {
    revokeUrl(state.originalUrl);
    resetCompressedPreview();
    state.file = null;
    state.originalUrl = "";
    state.naturalWidth = 0;
    state.naturalHeight = 0;
    state.outputWidth = 0;
    state.outputHeight = 0;
    fileInput.value = "";
    previewOriginal.hidden = true;
    previewOriginal.removeAttribute("src");
    previewOriginalEmpty.hidden = false;
    previewCompressedEmpty.textContent = "尚未压缩";
    infoPanel.hidden = true;
    infoName.textContent = "—";
    infoOriginalSize.textContent = "—";
    infoDimensions.textContent = "—";
    qualityEl.value = "0.8";
    formatEl.value = "original";
    maxWidthEl.value = "";
    maxHeightEl.value = "";
    updateFormatNote();
    updateButtons();
    showHint("", "");
  }

  function handleSelectedFile(file) {
    if (!file) return;

    if (!isAcceptedFile(file)) {
      showHint("仅支持 JPG、JPEG、PNG、WebP 格式。", "warn");
      return;
    }

    if (file.size > MAX_BYTES) {
      showHint("单张图片不能超过 20MB，请选择更小的文件。", "error");
      return;
    }

    revokeUrl(state.originalUrl);
    resetCompressedPreview();

    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      state.file = file;
      state.originalUrl = url;
      state.naturalWidth = img.naturalWidth;
      state.naturalHeight = img.naturalHeight;
      setOriginalPreview(url, img.naturalWidth, img.naturalHeight);
      infoPanel.hidden = false;
      infoName.textContent = file.name || "未命名";
      infoOriginalSize.textContent = formatBytes(file.size);
      previewCompressedEmpty.textContent = "尚未压缩";
      updateFormatNote();
      updateButtons();
      showHint("已加载图片，可调整参数后点击「开始压缩」。", "success");
    };
    img.onerror = function () {
      revokeUrl(url);
      showHint("图片无法读取，请换一张试试。", "error");
    };
    img.src = url;
  }

  function compressImage() {
    if (!state.file) {
      showHint("请先选择图片。", "warn");
      return;
    }

    var quality = getQuality();
    var maxW = parseOptionalPositive(maxWidthEl);
    var maxH = parseOptionalPositive(maxHeightEl);
    var mime = getOutputMime(state.file);

    state.compressing = true;
    updateButtons();
    showHint("正在压缩…", "info");

    loadImageFromFile(state.file)
      .then(function (loaded) {
        var size = calcOutputSize(loaded.img.naturalWidth, loaded.img.naturalHeight, maxW, maxH);
        var canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(loaded.img, 0, 0, size.width, size.height);
        revokeUrl(loaded.url);
        return canvasToBlob(canvas, mime, quality).then(function (blob) {
          return { blob: blob, size: size, mime: mime };
        });
      })
      .then(function (result) {
        if (!result.blob) {
          throw new Error("压缩失败。");
        }
        resetCompressedPreview();
        state.compressedBlob = result.blob;
        state.outputMime = result.mime;
        state.outputWidth = result.size.width;
        state.outputHeight = result.size.height;
        state.compressedUrl = URL.createObjectURL(result.blob);
        previewCompressed.src = state.compressedUrl;
        previewCompressed.hidden = false;
        previewCompressedEmpty.hidden = true;
        infoCompressedSize.textContent = formatBytes(result.blob.size);
        infoRatio.textContent = formatRatio(state.file.size, result.blob.size);
        infoDimensions.textContent =
          state.naturalWidth +
          " × " +
          state.naturalHeight +
          " → " +
          result.size.width +
          " × " +
          result.size.height;
        btnDownload.disabled = false;
        updateFormatNote();
        showHint("压缩完成。", "success");
      })
      .catch(function (err) {
        showHint(err.message || "压缩失败。", "error");
      })
      .finally(function () {
        state.compressing = false;
        updateButtons();
      });
  }

  function downloadCompressed() {
    if (!state.compressedBlob || !state.file) {
      showHint("请先完成压缩。", "warn");
      return;
    }
    var url = URL.createObjectURL(state.compressedBlob);
    var a = document.createElement("a");
    a.href = url;
    a.download = buildDownloadName(state.file, state.outputMime || getOutputMime(state.file));
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    revokeUrl(url);
    showHint("已开始下载。", "success");
  }

  btnPick.addEventListener("click", function () {
    fileInput.click();
  });

  dropzone.addEventListener("click", function () {
    fileInput.click();
  });

  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    if (file) handleSelectedFile(file);
  });

  ["dragenter", "dragover"].forEach(function (name) {
    dropzone.addEventListener(name, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach(function (name) {
    dropzone.addEventListener(name, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("is-dragover");
    });
  });

  dropzone.addEventListener("drop", function (e) {
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleSelectedFile(file);
  });

  formatEl.addEventListener("change", updateFormatNote);
  btnCompress.addEventListener("click", compressImage);
  btnDownload.addEventListener("click", downloadCompressed);
  btnClear.addEventListener("click", clearAll);

  updateFormatNote();
  updateButtons();
})();
