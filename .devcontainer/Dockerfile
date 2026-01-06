FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG USERNAME=vscode
ARG USER_UID=2000
ARG USER_GID=$USER_UID
ARG TARGETARCH

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    bash-completion \
    ca-certificates \
    curl \
    git \
    gnupg \
    locales \
    sudo \
    tzdata \
    zip \
    libatomic1 \
    openjdk-25-jdk \
  && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-25-openjdk-${TARGETARCH}
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
  && locale-gen
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

RUN groupadd --gid "${USER_GID}" "${USERNAME}" \
  && useradd -s /bin/bash --uid "${USER_UID}" --gid "${USER_GID}" -m "${USERNAME}" \
  && echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}" \
  && chmod 0440 "/etc/sudoers.d/${USERNAME}"

# Node.js 25
RUN apt-get update && \
    apt-get install -y nodejs npm && \
    npm install n -g && \
    n 25 && \
    npm install -g corepack && \
    apt-get purge -y nodejs npm && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Yarn (Berry) via Corepack
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

RUN cat <<'EOF' >/etc/profile.d/host-ip-playwright.sh
#!/usr/bin/env bash
# Resolve host.docker.internal to an IP and expose helper env vars.
if command -v getent >/dev/null 2>&1; then
  host_ip="$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' | tail -n 1)"
  if [ -n "$host_ip" ]; then
    export HOST_IP="$host_ip"
    if [ -z "$PLAYWRIGHT_REMOTE_CHROME_WS_ENDPOINT" ]; then
      export PLAYWRIGHT_REMOTE_CHROME_WS_ENDPOINT="http://${HOST_IP}:9222/"
    fi
  fi
fi
EOF
RUN chmod 0755 /etc/profile.d/host-ip-playwright.sh

USER ${USERNAME}
