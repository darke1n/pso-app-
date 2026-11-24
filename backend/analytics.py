import json
from typing import Any


def compute_analytics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "total_checkins": 0,
            "summary": {
                "avg_skin_score": None,
                "avg_stress_level": None,
                "avg_sleep_quality": None,
                "trend_delta": None,
            },
            "trigger_correlations": [],
            "factor_insights": [],
        }

    # Sort chronologically by date ascending
    sorted_rows = sorted(rows, key=lambda r: r["date"])
    total = len(sorted_rows)

    skin_scores = [r["skin_score"] for r in sorted_rows]
    stress_levels = [r["stress_level"] for r in sorted_rows]
    sleep_qualities = [r["sleep_quality"] for r in sorted_rows]

    overall_avg_skin = sum(skin_scores) / total
    overall_avg_stress = sum(stress_levels) / total
    overall_avg_sleep = sum(sleep_qualities) / total

    trend_delta = None
    if total >= 4:
        split = min(7, total // 2)
        prev_avg = sum(skin_scores[-2 * split : -split]) / split
        curr_avg = sum(skin_scores[-split:]) / split
        trend_delta = round(curr_avg - prev_avg, 2)

    # Identify days with worsening or low skin score
    day_triggers: list[tuple[dict[str, Any], bool, list[str]]] = []
    for idx, row in enumerate(sorted_rows):
        triggers = row["triggers"]
        if isinstance(triggers, str):
            try:
                triggers = json.loads(triggers)
            except json.JSONDecodeError:
                triggers = []
        triggers = [str(t).strip() for t in triggers if str(t).strip()]

        dropped_from_prev = idx > 0 and row["skin_score"] < sorted_rows[idx - 1]["skin_score"]
        below_avg_or_low = row["skin_score"] < overall_avg_skin or row["skin_score"] <= 5
        is_worsening = dropped_from_prev or below_avg_or_low
        day_triggers.append((row, is_worsening, triggers))

    # Aggregate stats per trigger
    trigger_map: dict[str, dict[str, Any]] = {}
    for row, is_worsening, triggers in day_triggers:
        for trig in set(triggers):
            entry = trigger_map.setdefault(
                trig,
                {"scores": [], "worsening_count": 0},
            )
            entry["scores"].append(row["skin_score"])
            if is_worsening:
                entry["worsening_count"] += 1

    correlations = []
    for trig, data in trigger_map.items():
        count = len(data["scores"])
        avg_with = sum(data["scores"]) / count
        without_scores = [
            row["skin_score"]
            for row, _, trigs in day_triggers
            if trig not in trigs
        ]
        avg_without = (
            sum(without_scores) / len(without_scores)
            if without_scores
            else overall_avg_skin
        )
        impact_delta = round(avg_with - avg_without, 2)
        worsening_rate = round((data["worsening_count"] / count) * 100)

        correlations.append(
            {
                "trigger": trig,
                "count": count,
                "avg_skin_with": round(avg_with, 2),
                "avg_skin_without": round(avg_without, 2),
                "impact_delta": impact_delta,
                "worsening_count": data["worsening_count"],
                "worsening_rate": worsening_rate,
            }
        )

    # Sort: most negative impact_delta first, then higher worsening_rate, then higher count
    correlations.sort(
        key=lambda x: (x["impact_delta"], -x["worsening_rate"], -x["count"])
    )

    # Factor insights (stress & sleep)
    factor_insights = []
    high_stress = [r["skin_score"] for r in sorted_rows if r["stress_level"] >= 7]
    low_stress = [r["skin_score"] for r in sorted_rows if r["stress_level"] < 7]
    if high_stress and low_stress:
        avg_hs = round(sum(high_stress) / len(high_stress), 2)
        avg_ls = round(sum(low_stress) / len(low_stress), 2)
        factor_insights.append(
            {
                "factor": "Высокий стресс (7–10)",
                "days_count": len(high_stress),
                "avg_skin_with": avg_hs,
                "avg_skin_without": avg_ls,
                "impact_delta": round(avg_hs - avg_ls, 2),
            }
        )

    poor_sleep = [r["skin_score"] for r in sorted_rows if r["sleep_quality"] <= 5]
    good_sleep = [r["skin_score"] for r in sorted_rows if r["sleep_quality"] > 5]
    if poor_sleep and good_sleep:
        avg_ps = round(sum(poor_sleep) / len(poor_sleep), 2)
        avg_gs = round(sum(good_sleep) / len(good_sleep), 2)
        factor_insights.append(
            {
                "factor": "Плохой сон (1–5)",
                "days_count": len(poor_sleep),
                "avg_skin_with": avg_ps,
                "avg_skin_without": avg_gs,
                "impact_delta": round(avg_ps - avg_gs, 2),
            }
        )

    return {
        "total_checkins": total,
        "summary": {
            "avg_skin_score": round(overall_avg_skin, 1),
            "avg_stress_level": round(overall_avg_stress, 1),
            "avg_sleep_quality": round(overall_avg_sleep, 1),
            "trend_delta": trend_delta,
        },
        "trigger_correlations": correlations,
        "factor_insights": factor_insights,
    }
