"""360 crops must look where they claim: yaw around the horizon, level, seamless across the panorama seam."""
import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from pipeline.split_360 import split_frame, view_maps  # noqa: E402

W, H = 3600, 1800


def test_view_centre_hits_requested_longitude_on_the_horizon():
    for yaw in (0, 45, 90, 270):
        map_x, map_y = view_maps(W, H, yaw, out_w=721, out_h=405)
        cx, cy = map_x[202, 360], map_y[202, 360]
        assert cx == pytest.approx((yaw / 360 + 0.5) % 1 * W - 0.5, abs=1)
        assert cy == pytest.approx(H / 2 - 0.5, abs=1)


def test_field_of_view_spans_the_requested_angle():
    map_x, _ = view_maps(W, H, 0, out_w=720, out_h=405, hfov_deg=70)
    span_deg = (map_x[202, -1] - map_x[202, 0]) / W * 360
    assert span_deg == pytest.approx(70, abs=0.5)


def test_crop_behind_the_camera_wraps_across_the_seam():
    # Column brightness encodes longitude, with a hard edge only at the seam (x = 0 / W).
    pano = np.tile(np.linspace(0, 255, W, dtype=np.float32), (H, 1)).astype(np.uint8)
    pano = np.dstack([pano] * 3)
    crop = split_frame(pano, [180], {}, out_w=200, out_h=100)[180]
    row = crop[50, :, 0].astype(int)
    assert row[:90].mean() > 200 and row[110:].mean() < 50  # right end of the pano, then the left end
