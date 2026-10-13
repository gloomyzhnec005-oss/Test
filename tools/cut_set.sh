#!/bin/sh
# Лист комплекта класса (4×2: 7 вещей + герб) → public/assets/items, и класс в SET_ART (public/js/itemart.js)
# sh tools/cut_set.sh sheet.png класс
c=$2
python3 tools/cut_items.py "$1" 4 2 weapon_set_$c,helm_set_$c,armor_set_$c,gloves_set_$c,boots_set_$c,ring_set_$c,amulet_set_$c,crest_$c || exit 1
grep -q "'$c'" public/js/itemart.js || sed -i "s/^const SET_ART = \[\(.*\)\];/const SET_ART = [\1, '$c'];/" public/js/itemart.js
grep "^const SET_ART" public/js/itemart.js
