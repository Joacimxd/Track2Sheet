FROM python:3.12-slim

# ffmpeg: audio conversion for yt-dlp / audio-separator; git: yt-dlp is installed from GitHub;
# build-essential: diffq (an audio-separator dependency) is compiled from source
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
# audio-separator imports audioread but doesn't declare it as a dependency
RUN pip install --no-cache-dir audioread

# Run as a normal user with the host's uid/gid so files in output/ belong to you.
ARG HOST_UID=1000
ARG HOST_GID=1000
RUN groupadd -g ${HOST_GID} app && useradd -m -u ${HOST_UID} -g ${HOST_GID} app
USER app

# The project folder is mounted here by docker-compose (notebooks, output, models, .env).
WORKDIR /workspace
EXPOSE 8888

CMD ["sh", "-c", "jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --ServerApp.token=\"$JUPYTER_TOKEN\" --ServerApp.root_dir=/workspace --LabApp.default_url=/lab/tree/notebooks/track2stems.ipynb"]
