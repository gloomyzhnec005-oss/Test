#!/bin/sh
# Подготовка звука для игры: обрезать тишину по краям, выровнять громкость, моно MP3 96 kbps.
# sh tools/prep_sfx.sh исходный.mp3 имя   →  public/assets/sfx/имя.mp3 (имя добавить в FILES в public/js/sfx.js)
ffmpeg -v error -y -i "$1" -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,afade=t=in:d=0.03,areverse,loudnorm=I=-16:TP=-1.5:LRA=7" -ac 1 -ar 44100 -b:a 96k "public/assets/sfx/$2.mp3"
