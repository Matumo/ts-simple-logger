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
    ssh \
    gnupg \
    locales \
    sudo \
    tzdata \
    wget \
    zip \
    libatomic1 \
    openjdk-25-jdk \
  && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-25-openjdk-${TARGETARCH}
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && locale-gen
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

# pnpm
RUN corepack enable && \
    corepack prepare pnpm@10.33.0+sha512.10568bb4a6afb58c9eb3630da90cc9516417abebd3fabbe6739f0ae795728da1491e9db5a544c76ad8eb7570f5c4bb3d6c637b2cb41bfdcdb47fa823c8649319 --activate && \
    pnpm completion bash > ~/completion-for-pnpm.bash && \
    echo 'source ~/completion-for-pnpm.bash' >> ~/.bashrc

USER ${USERNAME}
