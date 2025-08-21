import express from "express";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import ffmpeg from "ffmpeg-static";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

app.post("/transcribe", async (req, res) => {
  try {
    const { audioBase64 } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: "Falta audioBase64 en el body" });
    }

    // 1) Guardar OGG temporal en Windows
    const oggPath = path.join(__dirname, `temp_${Date.now()}.ogg`);
    fs.writeFileSync(oggPath, Buffer.from(audioBase64, "base64"));

    // 2) Convertir a WAV 16 kHz mono PCM (válido para whisper.cpp)
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

    // 3) Convertir rutas de Windows -> WSL
    const toWsl = p =>
      p.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`)
        .replace(/\\/g, "/");

    const wavWsl = toWsl(wavPath);
    const outBaseWin = `${wavPath}.out`;      // base Windows para leer el JSON
    const outBaseWsl = toWsl(outBaseWin);     // misma base pero en WSL

    // 4) Rutas de whisper y modelo (en WSL)
    const whisperBinWsl = "/mnt/c/audio-transcription/whisper.cpp/build/bin/whisper-cli";
    const modelPathWsl = "/mnt/c/audio-transcription/whisper.cpp/models/ggml-medium.bin";

    // 5) Ejecutar whisper dentro de WSL y pedir salida JSON
    await new Promise((resolve, reject) => {
      const child = spawn(
        "wsl",
        [whisperBinWsl, "-m", modelPathWsl, "-f", wavWsl, "-l", "es", "--output-json", "-of", outBaseWsl],
        { windowsHide: true }
      );
      let stderr = "";
      child.stderr.on("data", d => { stderr += d.toString(); });
      child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr || `whisper salió con código ${code}`)));
    });

    // 6) Leer JSON generado y armar la transcripción
    const json = JSON.parse(fs.readFileSync(`${outBaseWin}.json`, "utf8"));

    const transcription = json.transcription[0].text || "Valida la salida del modelo";

    // 7) Limpiar archivos temporales
    [oggPath, wavPath, outBaseWin, `${outBaseWin}.json`].forEach(f => {
      try { fs.unlinkSync(f); } catch (e) { /* ignorar errores */
      }
    });

    // 8) Responder
    res.json({ transcription });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API corriendo en http://localhost:${PORT}`);
});