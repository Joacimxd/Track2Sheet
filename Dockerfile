FROM python:3.12-slim-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git cmake ninja-build g++ curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node:22-trixie-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-trixie-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY engine/cli /opt/engine/cli
RUN git clone https://github.com/DamRsn/muscriptor.cpp.git /opt/engine/muscriptor.cpp \
    && git -C /opt/engine/muscriptor.cpp checkout --quiet 8589219cc3b584bce970f95aec2ec4a04e53b280 \
    && cmake -S /opt/engine/cli -B /opt/engine/build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /opt/engine/build \
    && mkdir -p /opt/engine/bin && cp /opt/engine/build/t2s_transcribe /opt/engine/bin/ \
    && rm -rf /opt/engine/build /opt/engine/muscriptor.cpp/.git

COPY requirements.txt /tmp/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements.txt

COPY web/package.json web/package-lock.json /workspace/web/
RUN cd /workspace/web && npm ci --no-audit --no-fund \
    && sha1sum package-lock.json > node_modules/.installed-lock

COPY docker/start.sh /usr/local/bin/start
ENV PYTHONPATH=/workspace \
    MUSCRIPTOR_BIN=/opt/engine/bin/t2s_transcribe \
    MUSCRIPTOR_MODEL=/workspace/models/muscriptor-large-f16.gguf
WORKDIR /workspace
EXPOSE 8765 5173 8888
CMD ["start"]
