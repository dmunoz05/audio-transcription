import fs from "fs";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import crypto from "crypto";

const WHISPER_BIN = "/ruta/a/whisper.cpp/main";   // 👈 Ajusta
const MODEL_PATH  = "/ruta/a/models/ggml-medium.bin"; // 👈 Ajusta

function execCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(stderr || err);
      resolve(stdout);
    });
  });
}

export async function transcribeFromBase64(b64) {
  const tmp = os.tmpdir();
  const id = crypto.randomUUID();
  const ogg = path.join(tmp, `${id}.ogg`);
  const wav = path.join(tmp, `${id}.wav`);
  const out = path.join(tmp, `${id}`);

  fs.writeFileSync(ogg, Buffer.from(b64, "base64"));

  // convertir a WAV PCM mono 16kHz
  await execCmd("ffmpeg", ["-y", "-i", ogg, "-ar", "16000", "-ac", "1", wav]);

  // correr whisper.cpp
  await execCmd(WHISPER_BIN, [
    "-m", MODEL_PATH,
    "-f", wav,
    "-l", "es",
    "--output-json",
    "-of", out
  ]);

  const jsonPath = `${out}.json`;
  const result = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  return result.segments?.map(s => s.text).join(" ").trim() || "";
}
