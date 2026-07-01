from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TAXONOMY_PATH = ROOT / "data" / "taxonomy" / "tag_rules.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成炉石标准模式版本化卡牌快照")
    parser.add_argument("--build", required=True, help="HearthstoneJSON 构建号")
    parser.add_argument("--patch", required=True, help="炉石补丁版本，例如 35.6")
    parser.add_argument("--date", required=True, help="快照日期，例如 2026-07-01")
    parser.add_argument("--download", action="store_true", help="先下载中英文原始数据")
    return parser.parse_args()


def download_raw(build: str, locale: str, target: Path) -> None:
    url = f"https://api.hearthstonejson.com/v1/{build}/{locale}/cards.collectible.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as response:
        target.write_bytes(response.read())


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def plain_text(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def normalized_classes(card: dict[str, Any]) -> list[str]:
    classes = card.get("classes") or [card.get("cardClass", "NEUTRAL")]
    return sorted(set(classes))


def effect_tags(text_en: str, rules: dict[str, list[str]]) -> list[str]:
    lowered = text_en.lower()
    return sorted(
        tag
        for tag, patterns in rules.items()
        if any(re.search(pattern, lowered) for pattern in patterns)
    )


def strategy_tags(effects: list[str], mapping: dict[str, list[str]]) -> list[str]:
    effect_set = set(effects)
    return sorted(tag for tag, required in mapping.items() if effect_set.intersection(required))


def make_record(
    card_en: dict[str, Any],
    card_zh: dict[str, Any],
    set_meta: dict[str, Any],
    taxonomy: dict[str, Any],
    build: str,
    patch: str,
    snapshot_id: str,
) -> dict[str, Any]:
    text_en = plain_text(card_en.get("text"))
    effects = effect_tags(text_en, taxonomy["effect_rules"])
    strategies = strategy_tags(effects, taxonomy["strategy_from_effects"])
    mechanics = sorted(set(card_en.get("mechanics", [])))
    races = sorted(set(card_en.get("races") or ([card_en["race"]] if card_en.get("race") else [])))

    base_tags = [
        f"SET_{card_en['set']}",
        f"TYPE_{card_en.get('type', 'UNKNOWN')}",
        f"COST_{card_en.get('cost', 0)}",
    ]
    base_tags.extend(f"CLASS_{value}" for value in normalized_classes(card_en))
    base_tags.extend(f"RACE_{value}" for value in races)
    if card_en.get("spellSchool"):
        base_tags.append(f"SPELL_SCHOOL_{card_en['spellSchool']}")

    record: dict[str, Any] = {
        "schema_version": 1,
        "id": card_en["id"],
        "dbf_id": card_en["dbfId"],
        "name": {
            "zh_cn": card_zh.get("name", ""),
            "en_us": card_en.get("name", ""),
        },
        "text": {
            "zh_cn": plain_text(card_zh.get("text")),
            "en_us": text_en,
        },
        "version": {
            "build": int(build),
            "patch": patch,
            "snapshot": snapshot_id,
            "standard_legal": True,
        },
        "set": {
            "id": card_en["set"],
            **set_meta,
        },
        "base": {
            "classes": normalized_classes(card_en),
            "type": card_en.get("type"),
            "rarity": card_en.get("rarity"),
            "cost": card_en.get("cost"),
            "attack": card_en.get("attack"),
            "health": card_en.get("health"),
            "durability": card_en.get("durability"),
            "armor": card_en.get("armor"),
            "races": races,
            "spell_school": card_en.get("spellSchool"),
        },
        "mechanics": mechanics,
        "referenced_tags": sorted(set(card_en.get("referencedTags", []))),
        "related_card_ids": sorted(set(card_en.get("entourage", []))),
        "play_requirements": card_en.get("playRequirements", {}),
        "tags": {
            "base": sorted(set(base_tags)),
            "mechanic": [f"MECHANIC_{value}" for value in mechanics],
            "effect": effects,
            "strategy_heuristic": strategies,
        },
    }
    return record


def main() -> None:
    args = parse_args()
    taxonomy = load_json(TAXONOMY_PATH)
    raw_dir = ROOT / "data" / "raw" / args.build
    paths = {locale: raw_dir / f"{locale}.json" for locale in ("zhCN", "enUS")}

    if args.download:
        for locale, path in paths.items():
            download_raw(args.build, locale, path)

    missing = [str(path) for path in paths.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(f"缺少原始数据: {', '.join(missing)}")

    cards_en = load_json(paths["enUS"])
    cards_zh_by_id = {card["id"]: card for card in load_json(paths["zhCN"])}
    standard_sets = taxonomy["standard_sets"]
    snapshot_id = f"{args.date}_{args.patch}_build-{args.build}"

    records = []
    missing_zh = []
    for card_en in cards_en:
        if card_en.get("set") not in standard_sets:
            continue
        card_zh = cards_zh_by_id.get(card_en["id"])
        if not card_zh:
            missing_zh.append(card_en["id"])
            card_zh = {}
        records.append(
            make_record(
                card_en,
                card_zh,
                standard_sets[card_en["set"]],
                taxonomy,
                args.build,
                args.patch,
                snapshot_id,
            )
        )

    records.sort(key=lambda card: (card["set"]["release_year"] or 0, card["set"]["id"], card["dbf_id"]))
    output_dir = ROOT / "data" / "snapshots" / snapshot_id
    output_dir.mkdir(parents=True, exist_ok=True)
    cards_path = output_dir / "standard_cards.jsonl"
    with cards_path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")

    set_counts = Counter(record["set"]["id"] for record in records)
    class_counts = Counter(value for record in records for value in record["base"]["classes"])
    type_counts = Counter(record["base"]["type"] for record in records)
    ids = [record["id"] for record in records]
    dbf_ids = [record["dbf_id"] for record in records]
    manifest = {
        "schema_version": 1,
        "snapshot_id": snapshot_id,
        "snapshot_date": args.date,
        "patch": args.patch,
        "build": int(args.build),
        "format": "STANDARD",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "source": {
            "provider": "HearthstoneJSON",
            "base_url": f"https://api.hearthstonejson.com/v1/{args.build}/",
            "raw_files": {
                locale: {"path": str(path.relative_to(ROOT)), "sha256": sha256(path)}
                for locale, path in paths.items()
            },
        },
        "included_sets": standard_sets,
        "excluded_preload_sets": taxonomy["excluded_preload_sets"],
        "counts": {
            "cards": len(records),
            "by_set": dict(sorted(set_counts.items())),
            "by_class": dict(sorted(class_counts.items())),
            "by_type": dict(sorted(type_counts.items())),
        },
        "validation": {
            "duplicate_ids": len(ids) - len(set(ids)),
            "duplicate_dbf_ids": len(dbf_ids) - len(set(dbf_ids)),
            "missing_zh_cn": missing_zh,
        },
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"生成完成: {cards_path}")
    print(f"卡牌数量: {len(records)}")
    print(f"系列统计: {dict(sorted(set_counts.items()))}")
    print(f"缺少中文: {len(missing_zh)}")


if __name__ == "__main__":
    main()
