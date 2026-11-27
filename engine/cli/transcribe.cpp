#include "muscriptor/muscriptor.hpp"

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
    std::vector<float> samples(static_cast<std::size_t>(file.tellg()) / sizeof(float));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(samples.data()), static_cast<std::streamsize>(samples.size() * sizeof(float)));
    return samples;
}

bool parseInstruments(std::string_view list, std::vector<msl::InstrumentGroup>& instruments)
{
    while (!list.empty()) {
        const auto comma = list.find(',');
        const std::string_view name = list.substr(0, comma);
        bool found = false;
        for (const msl::InstrumentGroup group : msl::allInstrumentGroups()) {
            if (msl::instrumentName(group) == name) {
                instruments.push_back(group);
                found = true;
            }
        }
        if (!found) {
            return false;
        }
        list = comma == std::string_view::npos ? std::string_view{} : list.substr(comma + 1);
    }
    return true;
}

}

int main(int argc, char** argv)
{
    std::filesystem::path model, audio, out;
    std::vector<msl::InstrumentGroup> instruments;

    for (int i = 1; i + 1 < argc; i += 2) {
        const std::string_view arg = argv[i];
        const char* value = argv[i + 1];
        if (arg == "--model") {
            model = value;
        } else if (arg == "--audio") {
            audio = value;
        } else if (arg == "--out") {
            out = value;
        } else if (arg == "--instruments") {
            if (!parseInstruments(value, instruments)) {
                return fail("unknown instrument in " + std::string(value));
            }
        } else {
            return fail("unknown option " + std::string(arg));
        }
    }
    if (model.empty() || audio.empty() || out.empty()) {
        return fail("usage: t2s_transcribe --model f.gguf --audio f.f32 --out notes.json [--instruments a,b]");
    }

    const std::vector<float> samples = readRawFloat(audio);
    if (samples.empty()) {
        return fail("cannot read audio (expected raw float32 16 kHz mono)");
    }

    auto transcriber = msl::Transcriber::load(model, msl::LoadOptions{});
    if (!transcriber) {
        return fail(msl::describe(transcriber.error()));
    }

    msl::TranscribeOptions options;
    options.instruments = instruments;
    auto notes = transcriber->transcribe(samples, options, [](const msl::TranscriptionUpdate& update) {
        std::cerr << "progress " << update.progress << std::endl;
        return true;
    });
    if (!notes) {
        return fail(msl::describe(notes.error()));
    }

    std::ofstream json(out);
    if (!json) {
        return fail("cannot write output file");
    }
    json << "{\"notes\":[";
    for (std::size_t i = 0; i < notes->size(); ++i) {
        const msl::Note& n = (*notes)[i];
        json << (i ? "," : "") << "{\"onset\":" << n.onset << ",\"offset\":" << n.offset << ",\"pitch\":" << n.pitch
             << ",\"program\":" << n.program << ",\"is_drum\":" << (n.is_drum ? "true" : "false")
             << ",\"instrument\":\"" << msl::instrumentLabel(n.program) << "\"}";
    }
    json << "]}\n";
    return 0;
}
