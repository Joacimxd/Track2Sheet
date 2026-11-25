// t2s_transcribe: run MuScriptor (the model inside NeuralNote v2) on an audio file and write the
// notes as JSON. Audio decoding and resampling are done by ffmpeg upstream (the FastAPI service),
// so the input is raw little-endian float32, 16 kHz, mono (`ffmpeg ... -f f32le -ac 1 -ar 16000`).
//
//   t2s_transcribe --model muscriptor-large-f16.gguf --audio song.f32 --out notes.json
//
// stderr carries one machine-readable line per event, for the caller to parse:
//   device <backend> <name>
//   load <0..1>
//   progress <0..1>
//   error <message>
// Output JSON: {"device": "...", "duration": s, "notes": [{"onset", "offset", "pitch",
//               "program", "is_drum", "instrument"}, ...]}

#include "muscriptor/muscriptor.hpp"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

namespace
{

int fail(std::string_view message)
{
    std::cerr << "error " << message << std::endl;
    return 1;
}

std::vector<float> readRawFloat(const std::filesystem::path& path)
{
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) {
        return {};
    }
    const auto bytes = static_cast<std::size_t>(file.tellg());
    std::vector<float> samples(bytes / sizeof(float));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(samples.data()), static_cast<std::streamsize>(samples.size() * sizeof(float)));
    return samples;
}

std::string jsonEscape(std::string_view s)
{
    std::string out;
    for (char c : s) {
        if (c == '"' || c == '\\') {
            out += '\\';
            out += c;
        } else if (static_cast<unsigned char>(c) < 0x20) {
            char buf[8];
            std::snprintf(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
        } else {
            out += c;
        }
    }
    return out;
}

} // namespace

int main(int argc, char** argv)
{
    std::filesystem::path model, audio, out;
    bool cpu = false;

    for (int i = 1; i < argc; ++i) {
        const std::string_view arg = argv[i];
        auto next = [&]() -> const char* { return i + 1 < argc ? argv[++i] : ""; };
        if (arg == "--model") {
            model = next();
        } else if (arg == "--audio") {
            audio = next();
        } else if (arg == "--out") {
            out = next();
        } else if (arg == "--cpu") {
            cpu = true;
        } else {
            std::cerr << "usage: t2s_transcribe --model f.gguf --audio f.f32 --out notes.json [--cpu]\n";
            return 2;
        }
    }
    if (model.empty() || audio.empty() || out.empty()) {
        return fail("missing --model, --audio or --out");
    }

    const std::vector<float> samples = readRawFloat(audio);
    if (samples.empty()) {
        return fail("cannot read audio (expected raw float32 16 kHz mono)");
    }

    msl::LoadOptions loadOptions;
    if (cpu) {
        loadOptions.device = msl::availableDevices().size() - 1; // CPU is always last
    }
    loadOptions.on_progress = [](float p) { std::cerr << "load " << p << std::endl; };

    auto transcriber = msl::Transcriber::load(model, loadOptions);
    if (!transcriber) {
        return fail(msl::describe(transcriber.error()));
    }
    const msl::Device& device = transcriber->device();
    std::cerr << "device " << device.backend << " " << device.name << std::endl;

    // NeuralNote v2 exposes no transcription settings, so the library defaults are used
    // (all instruments, prelude forcing, lead-in and silence gate on).
    msl::TranscribeOptions options;
    auto notes = transcriber->transcribe(samples, options, [](const msl::TranscriptionUpdate& u) {
        std::cerr << "progress " << u.progress << std::endl;
        return true;
    });
    if (!notes) {
        return fail(msl::describe(notes.error()));
    }

    std::ofstream json(out);
    if (!json) {
        return fail("cannot write output file");
    }
    json << "{\"device\":\"" << jsonEscape(device.backend) << " / " << jsonEscape(device.name) << "\","
         << "\"duration\":" << static_cast<double>(samples.size()) / msl::Transcriber::SAMPLE_RATE << ",\"notes\":[";
    for (std::size_t i = 0; i < notes->size(); ++i) {
        const msl::Note& n = (*notes)[i];
        json << (i ? "," : "") << "{\"onset\":" << n.onset << ",\"offset\":" << n.offset << ",\"pitch\":" << n.pitch
             << ",\"program\":" << n.program << ",\"is_drum\":" << (n.is_drum ? "true" : "false")
             << ",\"instrument\":\"" << jsonEscape(msl::instrumentLabel(n.program)) << "\"}";
    }
    json << "]}\n";
    std::cerr << "done " << notes->size() << std::endl;
    return 0;
}
