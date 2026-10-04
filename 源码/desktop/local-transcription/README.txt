梦藏本机音频转录运行时

用途：按需启动 whisper-cli，完成或取消后退出，不启动常驻服务器。
音频处理：本机 FFmpeg 转为 16 kHz、单声道、16-bit PCM WAV；Whisper 输出带时间戳的 SRT。
模型：Whisper large-v3-turbo 多语言 Q5_0 量化版。保留模型在磁盘；本目录不包含任何 API 密钥。
平台：macOS 13.0+，Apple Silicon arm64，Metal / Accelerate。首次运行需要编译内嵌 Metal kernel，后续通常更快。

官方来源与许可
- whisper.cpp v1.9.4： https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4
  源码： https://api.github.com/repos/ggml-org/whisper.cpp/tarball/v1.9.4
  MIT 许可见 whisper.cpp-LICENSE.txt。
  CLI 报告 1.9.4-dev，因为官方源码 tarball 不包含 .git 标签；源码固定来自 v1.9.4 发布 tag。
- 模型： https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
  Hugging Face LFS SHA-256：394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2
  原始 Whisper 模型 MIT 许可见 Whisper-model-LICENSE.txt。
- FFmpeg 9.0.2： https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
  LGPL 2.1 或更新版本，许可见 FFmpeg-LICENSE.txt。
  本次使用的完整未修改源码归档附于 FFmpeg-9.0.2-source.tar.xz。
  FFmpeg 与 Whisper 都只链接 macOS 系统库，不依赖外部 Homebrew 或第三方应用。

构建说明
Apple clang 21.0.0 (clang-2100.3.34.2)，CMake 4.4.4，macOS SDK 27.0。
whisper.cpp CMake 选项：
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 -DBUILD_SHARED_LIBS=OFF
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BACKEND_DL=OFF
  -DGGML_ACCELERATE=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
  -DWHISPER_CURL=OFF -DWHISPER_SDL2=OFF -DGGML_NATIVE=OFF
只构建 whisper-cli 目标，不构建或运行 whisper-server。

FFmpeg configure 选项：
  --arch=arm64 --cc=clang
  --extra-cflags=-mmacosx-version-min=13.0 --extra-ldflags=-mmacosx-version-min=13.0
  --disable-everything --disable-autodetect --disable-network --disable-doc
  --disable-debug --disable-shared --enable-static --disable-ffplay --disable-ffprobe
  --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avfilter
  --enable-swresample --disable-avdevice --disable-swscale
  --enable-protocol=file,pipe --enable-demuxer=wav,aiff,mp3,mov,aac,flac,ogg
  --enable-decoder=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_u8,mp3float,aac,alac,flac,vorbis,opus
  --enable-parser=mpegaudio,aac,flac,vorbis,opus --enable-encoder=pcm_s16le
  --enable-muxer=wav --enable-filter=aresample,aformat,anull,atrim,asetpts,abuffer,abuffersink
随后 make -j 8，复制 ffmpeg 并 codesign --force --sign -。

所有运行时文件的字节数和签名完成后的 SHA-256 见 runtime-manifest.json。
识别准确度依赖录音质量、口音和专名；允许用户校对，不自动生成 AI 摘要。
