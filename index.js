import { spawn } from "child_process";
import { fileURLToPath } from "url";
import ffmpeg from "ffmpeg-static";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Detectar sistema
const isWindows = os.platform() === "win32";

// Rutas desde .env
const whisperBin = process.env.WHISPER_BIN;
const modelPath = process.env.WHISPER_MODEL;

app.use(express.json({ limit: "50mb" }));

app.post("/transcribe", async (req, res) => {
  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: "Falta audioBase64 en el body" });
    }

    // 1) Guardar OGG temporal
    const oggPath = path.join(__dirname, `temp_${Date.now()}.ogg`);
    fs.writeFileSync(oggPath, Buffer.from(audioBase64, "base64"));

    // 2) Convertir a WAV 16 kHz mono PCM
    const wavPath = `${oggPath}.wav`;
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpeg, [
        "-y",
        "-i", oggPath,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        wavPath
      ], { windowsHide: true });

      ff.on("close", code => code === 0 ? resolve() : reject(new Error("ffmpeg falló")));
    });

    // 3) Normalizar rutas según sistema
    let wavExecPath = wavPath;
    let outBase = `${wavPath}.out`;

    if (isWindows) {
      // Convertir a WSL path
      const toWsl = p =>
        p.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`)
          .replace(/\\/g, "/");

      wavExecPath = toWsl(wavPath);
      outBase = toWsl(outBase);
    }

    // 4) Ejecutar whisper.cpp
    await new Promise((resolve, reject) => {
      const cmd = isWindows ? "wsl" : whisperBin;
      const args = isWindows
        ? [whisperBin, "-m", modelPath, "-f", wavExecPath, "-l", "es", "--output-json", "-of", outBase]
        : ["-m", modelPath, "-f", wavExecPath, "-l", "es", "--output-json", "-of", outBase];

      const child = spawn(cmd, args, { windowsHide: true });
      let stderr = "";
      child.stderr.on("data", d => { stderr += d.toString(); });
      child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr || `whisper salió con código ${code}`)));
    });

    // 5) Leer JSON generado
    const jsonPath = `${wavPath}.out.json`;
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

    const transcription = json.transcription?.[0]?.text || "Valida la salida del modelo";

    // 6) Limpiar archivos temporales
    [oggPath, wavPath, `${wavPath}.out`, `${wavPath}.out.json`].forEach(f => {
      try { fs.unlinkSync(f); } catch (e) {}
    });

    // 7) Responder
    res.json({ transcription: transcription });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API corriendo en http://localhost:${PORT}`);
});