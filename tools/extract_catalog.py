#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TABLES_DIR = Path("/home/jiyoung/workspace/무협위키/.local/graph/jingu-data/tables_ko")
DEFAULT_OUTPUT = ROOT / "src/catalog-data.js"

HANZI_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
TAG_RE = re.compile(r"</?(?:color|size|b|i)(?:\s*=\s*[^>]*)?\s*>", re.I)
PLACEHOLDER_RE = re.compile(r"【(\d+)】")

RESIDUE_REPLACEMENTS = (
    ("일기(\u4e00\u7d00", "12년"),
    ("일기（\u4e00\u7d00", "12년"),
    ("\u4e00\u7d00", "12년"),
    ("음\u715e지주", "음살지주"),
    ("음\u715e지기", "음살지기"),
    ("\u715e", "살"),
    ("\u7834\u721b\u8863\u7269", "해진 의복"),
    ("\u7834\u70c2\u8863\u7269", "해진 의복"),
    ("육\u5200", "육도"),
    ("\u5c0f\u98de\u5b88\u89d2", "날일자 굳힘"),
    ("\u5c0f\u98db\u5b88\u89d2", "날일자 굳힘"),
)

CAMPS = {
    0: "강호 무소속",
    1: "우가촌",
    2: "영구궁",
    3: "소림사",
    4: "청삼파",
    5: "주검산장",
    6: "은무위",
    7: "철시문",
    8: "칠보문",
    9: "조정",
    10: "설산파",
    11: "환룡회",
    12: "당문",
    13: "검려",
    14: "송산검파",
    15: "개방",
    16: "동해도심파",
    18: "해사방",
    19: "만수산장",
    20: "영남사살",
    21: "홍수거",
    22: "홍련고해교",
    23: "능가금강종",
    24: "조운방",
    25: "경수성",
    26: "합환종",
    27: "동림서각",
    28: "방흠무관",
    29: "대리성",
    30: "오독교",
    31: "칠살산장",
    32: "김무위",
    33: "백비곡",
    34: "막북왕정",
    35: "신도성",
    36: "대리왕궁",
    37: "정선사",
    38: "팔통상국",
    101: "결연 홍안",
    102: "영수·반려",
    103: "강호 유협",
}
DIRECTIONS = {
    0: "없음",
    1: "서(좌)",
    2: "북서",
    3: "북(상)",
    4: "북동",
    5: "동(우)",
    6: "남동",
    7: "남(하)",
    8: "남서",
}
WUXUE_TYPES = {
    0: "비전·공용 절기",
    1: "도법",
    2: "검법",
    3: "권장",
    4: "창곤",
    5: "암기",
    6: "금공",
    7: "심법",
    8: "외공",
    9: "경공",
}
ITEM_TYPES2 = {
    0: "일반 물품",
    1: "기초 자원",
    2: "도검 병기(도)",
    3: "명검 병기(검)",
    4: "권갑·장갑",
    5: "창·곤봉",
    6: "암기구",
    7: "거문고(금)",
    8: "의복·갑주",
    9: "신발·전투화",
    10: "장신구·패물",
    11: "무학 비급",
    12: "연단 단방",
    13: "단조 도안",
    14: "전투 도구",
    15: "연단·제작 재료",
    16: "영수 먹이",
    17: "단약·영약",
    18: "요리·음식",
    19: "명주·차·음료",
    20: "수산물·어류",
    21: "수렵 사냥감",
    22: "호감도 선물",
    23: "낚싯대·사냥활",
    24: "임무 신물·서찰",
}
QUALITIES = {
    0: "평범(백)",
    1: "하품(백)",
    2: "중품(녹)",
    3: "상품(청)",
    4: "진품(자)",
    5: "극품(금)",
    6: "절세(적)",
}
TREE_GROUPS = {1: "예봉", 2: "수호", 3: "신법", 4: "내공", 5: "임전"}


def as_int(value: Any, default: int = 0) -> int:
    if value is None or value == "":
        return default
    try:
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default


def norm_id(value: Any) -> int:
    return as_int(value, 0)


def field(row: Any, *names: str, default: Any = None) -> Any:
    if not isinstance(row, dict):
        return default
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    for name in names:
        candidates = []
        if not name.startswith("m_"):
            candidates.append("m_" + name)
        else:
            candidates.append(name[2:])
        candidates.append(name[0].lower() + name[1:] if name else name)
        for candidate in candidates:
            if candidate in row and row[candidate] is not None:
                return row[candidate]
    lowered = {str(k).lower(): v for k, v in row.items() if v is not None}
    for name in names:
        key = name.lower()
        for candidate in (key, "m_" + key, key[2:] if key.startswith("m_") else key):
            if candidate in lowered:
                return lowered[candidate]
    return default


def clean_text(value: Any, buff_names: dict[int, str] | None = None) -> str:
    if value is None:
        return ""
    text = str(value)
    text = TAG_RE.sub("", text)
    for old, new in RESIDUE_REPLACEMENTS:
        text = text.replace(old, new)
    if buff_names:
        def repl(match: re.Match[str]) -> str:
            bid = int(match.group(1))
            name = buff_names.get(bid)
            if name is None:
                return match.group(0)
            return f"【{name}】"
        text = PLACEHOLDER_RE.sub(repl, text)
    text = HANZI_RE.sub("", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text)
    return text.strip()


def sanitize_value(value: Any, buff_names: dict[int, str] | None = None) -> Any:
    if isinstance(value, str):
        return clean_text(value, buff_names)
    if isinstance(value, list):
        return [sanitize_value(v, buff_names) for v in value]
    if isinstance(value, tuple):
        return [sanitize_value(v, buff_names) for v in value]
    if isinstance(value, dict):
        return OrderedDict((k, sanitize_value(v, buff_names)) for k, v in value.items())
    return value


def table_rows(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if not isinstance(data, dict):
        return []
    for key in ("rows", "data", "list", "items", "table", "m_rows", "m_data", "entries"):
        value = data.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
        if isinstance(value, dict):
            nested = table_rows(value)
            if nested:
                return nested
    if all(isinstance(v, dict) for v in data.values()):
        return [v for v in data.values() if isinstance(v, dict)]
    numeric = []
    for key, value in data.items():
        if isinstance(value, dict) and str(key).lstrip("-").isdigit():
            numeric.append(value)
    if numeric:
        return numeric
    return []


def load_json(path: Path, required: bool = True) -> Any:
    if not path.exists():
        if required:
            raise FileNotFoundError(str(path))
        return None
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def load_table(tables_dir: Path, name: str, required: bool = True) -> list[dict[str, Any]]:
    data = load_json(tables_dir / name, required=required)
    if data is None:
        return []
    return table_rows(data)


def by_id(rows: Iterable[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    for row in rows:
        rid = norm_id(field(row, "id"))
        if rid:
            result[rid] = row
    return result


def name_of(row: Any) -> str:
    return clean_text(field(row, "name", default=""))


def number_or_text(value: Any) -> Any:
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        return [number_or_text(x) for x in value]
    if isinstance(value, dict):
        return {str(k): number_or_text(v) for k, v in value.items()}
    try:
        if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
            return int(value.strip())
        if isinstance(value, str) and re.fullmatch(r"-?\d+\.\d+", value.strip()):
            return float(value.strip())
    except ValueError:
        pass
    return clean_text(value)


def extract(tables_dir: Path) -> OrderedDict[str, Any]:
    buff_rows = load_table(tables_dir, "Buff.json", required=False)
    buff_names: dict[int, str] = {}
    for row in buff_rows:
        rid = norm_id(field(row, "id"))
        if rid:
            buff_names[rid] = clean_text(field(row, "name", default=f"버프 {rid}"))

    item_rows = load_table(tables_dir, "Item.json")
    items_by_id = by_id(item_rows)
    item_name = {rid: clean_text(field(row, "name", default=f"아이템 {rid}")) for rid, row in items_by_id.items()}

    equip_rows = load_table(tables_dir, "Equip.json")
    wuxue_rows = load_table(tables_dir, "WuXue.json")
    skill_rows = load_table(tables_dir, "Skill.json")
    passive_rows = load_table(tables_dir, "Passive.json")
    global_buff_rows = load_table(tables_dir, "GlobalBuff.json")
    custom_rows = load_table(tables_dir, "Custom.json")
    npc_rows = load_table(tables_dir, "Npc.json")
    friend_rows = load_table(tables_dir, "Friend.json")
    animal_rows = load_table(tables_dir, "Animal.json")
    scene_rows = load_table(tables_dir, "Scene.json")
    task_rows = load_table(tables_dir, "Task.json")
    tree_rows = load_table(tables_dir, "Tree.json")
    danfang_rows = load_table(tables_dir, "DanFang.json")
    dazao_rows = load_table(tables_dir, "DaZao.json")
    fishrod_rows = load_table(tables_dir, "FishRod.json")
    huntbow_rows = load_table(tables_dir, "HuntBow.json")
    achieve_rows = load_table(tables_dir, "Achieve.json")
    difficult_rows = load_table(tables_dir, "Difficult.json")
    effect_rows = load_table(tables_dir, "Effect.json")
    point_attr_rows = load_table(tables_dir, "PointAttribute.json")
    point_lv_rows = load_table(tables_dir, "PointLv.json")

    character_rows = load_table(tables_dir, "Character.json", required=False)
    book_rows = load_table(tables_dir, "Book.json", required=False)
    characters = by_id(character_rows)
    books = by_id(book_rows)

    def item_name_for(row: dict[str, Any], fallback_id: int | None = None) -> str:
        rid = norm_id(field(row, "itemId", "item_id", "m_itemId", "m_item_id", default=0))
        if not rid:
            row_id = norm_id(field(row, "id", default=0))
            for candidate in (field(row, "equipId", "m_equipId"), field(row, "bookId", "m_bookId")):
                cid = norm_id(candidate)
                if cid:
                    rid = cid
                    break
            if not rid and row_id in item_name:
                rid = row_id
        if rid in item_name:
            return item_name[rid]
        if fallback_id in item_name:
            return item_name[fallback_id]
        direct = clean_text(field(row, "name", default=""))
        if direct:
            return direct
        target = fallback_id if fallback_id is not None else rid
        return f"아이템 {target}" if target else ""

    def npc_name(row: dict[str, Any], npc_id: int) -> str:
        character_id = norm_id(field(row, "characterId", "character_id", default=0))
        character = characters.get(character_id)
        if character:
            book_id = norm_id(field(character, "book", "m_book", default=0))
            book = books.get(book_id)
            if book:
                book_name = clean_text(field(book, "name", default=""))
                if book_name:
                    return book_name
        direct = clean_text(field(row, "name", default=""))
        if direct:
            return direct
        return f"NPC #{npc_id}"

    def grouped_rows(rows: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
        grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for idx, row in enumerate(rows, 1):
            npc_id = norm_id(field(row, "npcId", "npc_id", default=0))
            if not npc_id:
                npc_id = norm_id(field(row, "id", default=idx))
            grouped[npc_id].append(row)
        out: list[dict[str, Any]] = []
        for npc_id in sorted(grouped):
            g_rows = grouped[npc_id]
            resolved_name = ""
            max_lv = 1
            for r in g_rows:
                lv = as_int(field(r, "level", "maxLevel", "lvMax", default=1), 1)
                if lv > max_lv:
                    max_lv = lv
                if not resolved_name:
                    cid = norm_id(field(r, "characterId", "character_id", default=0))
                    ch = characters.get(cid)
                    if ch:
                        bk = books.get(norm_id(field(ch, "book", "m_book", default=0)))
                        if bk:
                            resolved_name = clean_text(field(bk, "name", default=""))
            out.append(OrderedDict(
                npcId=npc_id,
                name=resolved_name or f"{kind} #{npc_id}",
                maxLevel=max_lv,
            ))
        return out

    catalog: OrderedDict[str, Any] = OrderedDict()

    catalog["items"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            quality=number_or_text(field(row, "quality")),
            value=number_or_text(field(row, "value")),
            type=number_or_text(field(row, "type")),
            type2=number_or_text(field(row, "type2", "type_2")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
        )
        for row in item_rows
    ]

    equips_out = []
    for row in equip_rows:
        eid = norm_id(field(row, "id"))
        irow = items_by_id.get(eid, {})
        equips_out.append(
            OrderedDict(
                id=eid,
                name=clean_text(field(irow, "name", default="")) or clean_text(field(row, "name", default=f"장비 {eid}")),
                quality=number_or_text(field(irow, "quality", default=0)),
                type2=number_or_text(field(irow, "type2", "type_2", default=0)),
                effectId=number_or_text(field(row, "effectId", "effect_id", default=[])),
                effectValue=number_or_text(field(row, "effectValue", "effect_value", default=[])),
                passive=number_or_text(field(row, "passive", default=0)),
            )
        )
    catalog["equips"] = equips_out

    catalog["wuxue"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=item_name_for(row),
            type=number_or_text(field(row, "type")),
            lvMax=number_or_text(field(row, "lvMax", "lv_max", "maxLevel")),
            exp=number_or_text(field(row, "exp")),
            lvNeed=number_or_text(field(row, "lvNeed", "lv_need")),
            skill=number_or_text(field(row, "skill")),
            effectId=number_or_text(field(row, "effectId", "effect_id", default=[])),
            effectValue=number_or_text(field(row, "effectValue", "effect_value", default=[])),
            condition=number_or_text(field(row, "condition")),
            conditionValue=number_or_text(field(row, "conditionValue", "condition_value")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
            special=number_or_text(field(row, "special")),
        )
        for row in wuxue_rows
    ]

    catalog["skills"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            quality=number_or_text(field(row, "quality")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
            mpCost=number_or_text(field(row, "mpCost", "mp_cost")),
            cd=number_or_text(field(row, "cd", "coolDown", "cooldown")),
            brief=clean_text(field(row, "brief", default=""), buff_names),
        )
        for row in skill_rows
    ]

    catalog["passives"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            quality=number_or_text(field(row, "quality")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
            brief=clean_text(field(row, "brief", default=""), buff_names),
        )
        for row in passive_rows
    ]

    catalog["globalBuffs"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            quality=number_or_text(field(row, "quality")),
            type=number_or_text(field(row, "type")),
            value=number_or_text(field(row, "value")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
        )
        for row in global_buff_rows
    ]

    catalog["customs"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            kind=number_or_text(field(row, "kind")),
            cost=number_or_text(field(row, "cost")),
            achieve=number_or_text(field(row, "achieve")),
        )
        for row in custom_rows
    ]

    npcs = []
    for row in npc_rows:
        npc_id = norm_id(field(row, "id"))
        npcs.append(
            OrderedDict(
                id=npc_id,
                name=npc_name(row, npc_id),
                group=number_or_text(field(row, "group")),
                characterId=norm_id(field(row, "characterId", "character_id")),
                favor=number_or_text(field(row, "favor")),
                hide=number_or_text(field(row, "hide")),
                evil=number_or_text(field(row, "evil")),
            )
        )
    catalog["npcs"] = npcs

    catalog["friends"] = grouped_rows(friend_rows, "친구")
    catalog["animals"] = grouped_rows(animal_rows, "동물")

    scenes = [OrderedDict(id=0, name="시작 장면", type=0)]
    for row in scene_rows:
        scenes.append(
            OrderedDict(
                id=norm_id(field(row, "id")),
                name=clean_text(field(row, "name", default="")),
                type=number_or_text(field(row, "type")),
            )
        )
    catalog["scenes"] = scenes

    catalog["tasks"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            branch=number_or_text(field(row, "branch")),
            group=number_or_text(field(row, "group")),
            name=clean_text(field(row, "name", default="")),
            title=clean_text(field(row, "title", default=""), buff_names),
            desc=clean_text(field(row, "desc", "description"), buff_names),
            reputation=number_or_text(field(row, "reputation")),
        )
        for row in task_rows
    ]

    catalog["trees"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            group=number_or_text(field(row, "group")),
            pre=number_or_text(field(row, "pre")),
            effectId=number_or_text(field(row, "effectId", "effect_id", default=[])),
            effectValue=number_or_text(field(row, "effectValue", "effect_value", default=[])),
            passive=number_or_text(field(row, "passive")),
            cost=number_or_text(field(row, "cost")),
        )
        for row in tree_rows
    ]

    catalog["danFang"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=item_name_for(row),
            lv=number_or_text(field(row, "lv")),
            danYao=number_or_text(field(row, "danYao", "dan_yao")),
        )
        for row in danfang_rows
    ]

    catalog["daZao"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=item_name_for(row),
            lv=number_or_text(field(row, "lv")),
            get=number_or_text(field(row, "get")),
        )
        for row in dazao_rows
    ]

    catalog["fishRods"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=item_name_for(row),
            pull=number_or_text(field(row, "pull")),
            time=number_or_text(field(row, "time")),
            speed=number_or_text(field(row, "speed")),
        )
        for row in fishrod_rows
    ]

    catalog["huntBows"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=item_name_for(row),
            speed=number_or_text(field(row, "speed")),
            shootSpeed=number_or_text(field(row, "shootSpeed", "shoot_speed")),
            damage=number_or_text(field(row, "damage")),
        )
        for row in huntbow_rows
    ]

    catalog["achieves"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            type=number_or_text(field(row, "type")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
            hide=number_or_text(field(row, "hide")),
            reward=number_or_text(field(row, "reward")),
        )
        for row in achieve_rows
    ]

    catalog["difficults"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            hp=number_or_text(field(row, "hp")),
            atk=number_or_text(field(row, "atk")),
            def_=number_or_text(field(row, "def")),
            speed=number_or_text(field(row, "speed")),
            desc=clean_text(field(row, "desc", "description"), buff_names),
        )
        for row in difficult_rows
    ]
    for entry in catalog["difficults"]:
        entry["def"] = entry.pop("def_")

    catalog["effects"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            name=clean_text(field(row, "name", default="")),
            addName=clean_text(field(row, "addName", "add_name"), buff_names),
            desc=clean_text(field(row, "desc", "description"), buff_names),
            initValue=number_or_text(field(row, "initValue", "init_value")),
        )
        for row in effect_rows
    ]

    catalog["pointAttributes"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            effectId=number_or_text(field(row, "effectId", "effect_id", default=[])),
            effectValue=number_or_text(field(row, "effectValue", "effect_value", default=[])),
        )
        for row in point_attr_rows
    ]

    catalog["pointLvs"] = [
        OrderedDict(
            id=norm_id(field(row, "id")),
            type=number_or_text(field(row, "type")),
            lv=number_or_text(field(row, "lv")),
            value=number_or_text(field(row, "value")),
            effectId=number_or_text(field(row, "effectId", "effect_id", default=[])),
            effectValue=number_or_text(field(row, "effectValue", "effect_value", default=[])),
            passive=number_or_text(field(row, "passive")),
        )
        for row in point_lv_rows
    ]

    catalog["camps"] = OrderedDict((str(k), v) for k, v in CAMPS.items())
    catalog["directions"] = OrderedDict((str(k), v) for k, v in DIRECTIONS.items())
    catalog["wuxueTypes"] = OrderedDict((str(k), v) for k, v in WUXUE_TYPES.items())
    catalog["itemTypes2"] = OrderedDict((str(k), v) for k, v in ITEM_TYPES2.items())
    catalog["qualities"] = OrderedDict((str(k), v) for k, v in QUALITIES.items())
    catalog["treeGroups"] = OrderedDict((str(k), v) for k, v in TREE_GROUPS.items())

    return sanitize_value(catalog, buff_names)


def make_umd(catalog: dict[str, Any]) -> str:
    payload = json.dumps(catalog, ensure_ascii=False, indent=2, separators=(",", ": "))
    return (
        "(function(root,factory){\n"
        "  if(typeof module==='object'&&module.exports){module.exports=factory();}\n"
        "  else{root.JinGuCatalog=factory();}\n"
        "})(typeof self!=='undefined'?self:this,function(){\n"
        "  'use strict';\n"
        f"  return {payload};\n"
        "});\n"
    )


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        try:
            dir_fd = os.open(str(path.parent), os.O_DIRECTORY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        except (AttributeError, OSError):
            pass
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass


def validate_text(text: str) -> list[str]:
    errors: list[str] = []
    if HANZI_RE.search(text):
        errors.append("Hanzi characters remain")
    for token in ("<color", "</color", "<size", "</size", "<b>", "</b>", "<i>", "</i>"):
        if token.lower() in text.lower():
            errors.append(f"forbidden tag remains: {token}")
            break
    return errors


def validate_catalog_js(path: Path) -> list[str]:
    errors: list[str] = []
    if not path.exists():
        return [f"missing output: {path}"]
    text = path.read_text(encoding="utf-8")
    errors.extend(validate_text(text))
    if "JinGuCatalog" not in text:
        errors.append("JinGuCatalog export not found")
    if "module.exports" not in text or "root.JinGuCatalog" not in text:
        errors.append("invalid UMD wrapper")
    catalog = None
    try:
        start = text.find("  return ") + len("  return ")
        end = text.rfind(";\n});")
        if start < len("  return ") or end < start:
            raise ValueError("payload markers not found")
        payload = text[start:end]
        catalog = json.loads(payload)
    except Exception as exc:
        errors.append(f"invalid catalog payload: {exc}")
    required_arrays = (
        "items", "equips", "wuxue", "skills", "passives", "globalBuffs", "customs",
        "npcs", "friends", "animals", "scenes", "tasks", "trees", "danFang", "daZao", "fishRods",
        "huntBows", "achieves", "difficults", "effects", "pointAttributes", "pointLvs",
    )
    if isinstance(catalog, dict):
        for key in required_arrays:
            value = catalog.get(key)
            if not isinstance(value, list) or not value:
                errors.append(f"catalog array is missing or empty: {key}")
        for key in ("camps", "directions", "wuxueTypes", "itemTypes2", "qualities", "treeGroups"):
            value = catalog.get(key)
            if not isinstance(value, dict) or not value:
                errors.append(f"catalog map is missing or empty: {key}")
    else:
        errors.append("catalog payload is not an object")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract JinGu Qunxiazhuan catalog data")
    parser.add_argument("--tables-dir", type=Path, default=DEFAULT_TABLES_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args(argv)

    output = args.output if args.output.is_absolute() else ROOT / args.output
    if args.check_only:
        errors = validate_catalog_js(output)
        if errors:
            for error in errors:
                print(f"ERROR: {error}", file=sys.stderr)
            return 1
        print(f"OK: {output}")
        return 0

    catalog = extract(args.tables_dir)
    text = make_umd(catalog)
    errors = validate_text(text)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    atomic_write(output, text)
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
