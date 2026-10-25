"""Frame review decisions must reach labels.csv safely and only for real graph nodes."""
import csv
import json

import numpy as np
import pytest

from pipeline.review_frames import Review, Suggester, apply_decisions, read_rows, save_decisions

FIELDS = ["file", "video", "t_sec", "label", "label_source", "in_graph", "sharpness", "dup_of_prev", "status", "heading"]


def make_data(tmp_path):
    data = tmp_path / "data"
    dataset = data / "walk"
    (data / "walk").mkdir(parents=True)
    (data / "graph.json").write_text(json.dumps({"nodes": [
        {"id": "F2_hall_e2", "floor": 2}, {"id": "F2_class48b", "floor": 2}, {"id": "F13_event", "floor": 13}]}))
    rows = [
        ("a.jpg", "V1", 0.0, "F2_hall_e2", "keep"),
        ("b.jpg", "V1", 0.5, "REVIEW_262", "review_not_in_graph"),
        ("c.jpg", "V1", 1.0, "F2_hall_e2", "reject_blurry"),
    ]
    with open(dataset / "labels.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        for file, video, t, label, status in rows:
            w.writerow({"file": file, "video": video, "t_sec": t, "label": label, "label_source": "voice",
                        "in_graph": True, "sharpness": 400, "dup_of_prev": False, "status": status, "heading": "F2_x"})
            folder = dataset / ("train/" + label if status == "keep" else status)
            folder.mkdir(parents=True, exist_ok=True)
            (folder / file).write_bytes(b"jpg")
    return data, dataset


def decisions(*items):
    return {f: {"file": f, "decision": d, "label": l, "decided_at": "now"} for f, d, l in items}


def test_apply_moves_frames_and_rewrites_labels(tmp_path):
    data, dataset = make_data(tmp_path)
    save_decisions(dataset, decisions(("b.jpg", "keep", "F2_class48b"), ("c.jpg", "keep", "F2_hall_e2"),
                                      ("a.jpg", "drop", "")))
    nodes = {"F2_hall_e2": "", "F2_class48b": ""}
    counts = apply_decisions(dataset, nodes)
    assert counts == {"kept": 2, "dropped": 1}
    rows = {r["file"]: r for r in read_rows(dataset)[1]}
    assert (rows["b.jpg"]["status"], rows["b.jpg"]["label"], rows["b.jpg"]["label_source"]) == ("keep", "F2_class48b", "review")
    assert rows["b.jpg"]["heading"] == ""
    assert rows["c.jpg"]["heading"] == "F2_x"  # same label: walk heading still valid
    assert rows["a.jpg"]["status"] == "reject_review"
    assert (dataset / "train/F2_class48b/b.jpg").exists() and not (dataset / "review_not_in_graph/b.jpg").exists()
    assert (dataset / "train/F2_hall_e2/c.jpg").exists() and (dataset / "reject_review/a.jpg").exists()
    # A second apply changes nothing.
    assert apply_decisions(dataset, nodes) == {"unchanged": 3}


def test_apply_skips_labels_that_are_not_graph_nodes(tmp_path):
    data, dataset = make_data(tmp_path)
    save_decisions(dataset, decisions(("b.jpg", "keep", "REVIEW_262")))
    assert apply_decisions(dataset, {"F2_hall_e2": ""}) == {"skipped_not_in_graph": 1}
    assert (dataset / "review_not_in_graph/b.jpg").exists()


def test_review_rejects_out_of_scope_labels_and_persists_decisions(tmp_path):
    data, dataset = make_data(tmp_path)
    review = Review(data, suggest=False)
    assert set(review.nodes) == {"F2_hall_e2", "F2_class48b"}  # F13 is outside the event floors
    with pytest.raises(ValueError):
        review.decide(["walk/b.jpg"], "keep", "F13_event")
    review.decide(["walk/b.jpg", "walk/c.jpg"], "keep", "F2_class48b")
    review.decide(["walk/c.jpg"], "clear")
    assert set(Review(data, suggest=False).decisions["walk"]) == {"b.jpg"}
    assert review.apply()["walk"] == {"kept": 1}
    assert any(f["file"] == "b.jpg" and f["status"] == "keep" for f in review.frames)


def test_suggestions_ignore_frames_from_the_same_video(tmp_path):
    suggester = Suggester(tmp_path)
    frames = [{"id": i, "key": i, "dataset": "d", "video": v} for i, v in (("q", "V1"), ("same", "V1"), ("other", "V2"))]
    suggester.vectors = {"q": np.array([1, 0], np.float32), "same": np.array([1, 0], np.float32),
                         "other": np.array([0.6, 0.8], np.float32)}
    out = suggester.suggest(frames, {"q": None, "same": "A", "other": "B"})
    assert out["q"] == [{"spot": "B", "votes": 1}]
