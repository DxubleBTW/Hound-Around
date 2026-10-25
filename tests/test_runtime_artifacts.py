"""Calibration binding and atomic activation; all files are synthetic."""
import json
from pathlib import Path
import shutil
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
import numpy as np
import pytest

from api.main import create_app
from ml.artifacts import build_manifest, recognition_context, runtime_directory, validate_manifest
from ml.calibration import FEATURES, TARGET, load_model, model_from_config
from ml.research.calibrate_confidence import fit, report
from scripts.fetch_data import main as fetch_data
from test_backend import FakeML, router


def package(directory):
    directory.mkdir(parents=True, exist_ok=True)
    from ml.embedder import MODEL_NAME
    from ml.index import VectorIndex
    VectorIndex(np.ones((1, 384), dtype=np.float32) / np.sqrt(384),
                ['F1_synthetic'], ['video'], model_name=MODEL_NAME).save(directory / 'index.npz')
    for name in ('graph.json', 'rooms.json'):
        (directory / name).write_bytes(b'synthetic ' + name.encode())
    manifest = build_manifest(directory)
    (directory / 'runtime-manifest.json').write_text(json.dumps(manifest))
    return manifest


def confidence(context):
    return {'schema_version': 1, 'context': context, 'target': TARGET, 'features': list(FEATURES),
            'split': 'validation', 'coefficients': [1, 0, 0, 0, 0], 'intercept': 0, 'low': .5, 'high': .7}


def test_confidence_binding_and_missing_configuration(tmp_path):
    package(tmp_path)
    context = recognition_context(tmp_path, model='synthetic')
    assert load_model(tmp_path, tmp_path / 'index.npz', 'synthetic') is None
    config = confidence(context)
    (tmp_path / 'confidence.json').write_text(json.dumps(config))
    model = load_model(tmp_path, tmp_path / 'index.npz', 'synthetic')
    assert model.predict(dict.fromkeys(FEATURES, 0)) == .5
    for name in ('index.npz', 'graph.json', 'rooms.json'):
        original = (tmp_path / name).read_bytes()
        (tmp_path / name).write_bytes(b'changed')
        with pytest.raises(ValueError, match='refit'):
            load_model(tmp_path, tmp_path / 'index.npz', 'synthetic')
        (tmp_path / name).write_bytes(original)
    with pytest.raises(ValueError, match='refit'):
        model_from_config({**config, 'context': {**context, 'decision_version': 'old'}}, context)
    with pytest.raises(ValueError, match='refit'):
        load_model(tmp_path, tmp_path / 'index.npz', 'different-model')


def test_manifest_reads_the_index_descriptor_and_projected_identity(tmp_path):
    from ml.embedder import MEGALOC_DIM, MEGALOC_MODEL_NAME, Projector
    from ml.index import VectorIndex
    package(tmp_path)
    projection = Projector(np.zeros(MEGALOC_DIM), np.ones((4, MEGALOC_DIM)))
    VectorIndex(np.ones((1, 4), dtype=np.float32) / 2, ['F1_synthetic'], ['video'],
                pca=projection, model_name=MEGALOC_MODEL_NAME).save(tmp_path / 'index.npz')
    manifest = build_manifest(tmp_path)
    assert manifest['context']['model'] == MEGALOC_MODEL_NAME + '+pca4'
    (tmp_path / 'runtime-manifest.json').write_text(json.dumps(manifest))
    assert validate_manifest(tmp_path) == manifest


@pytest.mark.parametrize('change', [{'coefficients': [1]}, {'intercept': float('nan')},
                                   {'high': True}, {'low': .9, 'high': .7}, {'target': 'exact_spot'}])
def test_confidence_rejects_invalid_or_different_target_artifacts(tmp_path, change):
    context = recognition_context(tmp_path)
    with pytest.raises(ValueError):
        model_from_config({**confidence(context), **change}, context)


def test_fit_is_deterministic_and_report_exposes_wrong_auto_floors():
    x = [[0, 0, .1, 0, 0], [1, 1, 1, 1, 0]] * 10
    y = [0, 1] * 10
    model = fit(x, y)
    assert model == fit(x, y)
    assert model.predict(dict(zip(FEATURES, x[0]))) < .5
    assert model.predict(dict(zip(FEATURES, x[1]))) > .7
    result = report([{'features': dict(zip(FEATURES, x[1])), 'correct': False,
                      'same_floor': False, 'exact': False}], model)
    assert result['auto_wrong_floor_rate'] == 1
    assert result['auto_wrong_location_rate'] == 1
    with pytest.raises(ValueError, match='both correct'):
        fit(x, [1] * len(x))
    from ml.calibration import Model
    assert Model((10000,) * 5, 0).predict(dict.fromkeys(FEATURES, -1)) == 0


def test_manifest_covers_optional_files_and_code_and_missing_required(tmp_path, monkeypatch):
    package(tmp_path)
    assert validate_manifest(tmp_path)
    (tmp_path / 'confidence.json').write_text('{}')
    with pytest.raises(ValueError, match='fingerprints'):
        validate_manifest(tmp_path)
    (tmp_path / 'confidence.json').unlink()
    monkeypatch.setattr('ml.artifacts.code_digest', lambda *args: 'changed-code')
    with pytest.raises(ValueError, match='fingerprints'):
        validate_manifest(tmp_path)
    (tmp_path / 'runtime-manifest.json').unlink()
    with pytest.raises(ValueError, match='required'):
        validate_manifest(tmp_path, required=True)


def test_invalid_package_never_reports_ready_even_with_injected_model(tmp_path, router):
    package(tmp_path)
    (tmp_path / 'index.npz').write_bytes(b'changed')
    with TestClient(create_app(tmp_path, FakeML(router.nodes['test_hall']), router)) as client:
        assert client.get('/health').status_code == 503
        assert client.get('/route', params={'from': 'test_entry', 'to': 'TEST'}).status_code == 503


def test_download_is_pinned_complete_and_failed_candidate_preserves_previous(tmp_path, monkeypatch):
    source, root = tmp_path / 'source', tmp_path / 'installed'
    package(source)
    monkeypatch.setenv('HOUND_DATA_REPO', 'synthetic/private')
    monkeypatch.setenv('HOUND_DATA_DIR', str(root))
    monkeypatch.setenv('HF_TOKEN', 'synthetic-test-token')
    monkeypatch.setenv('HOUND_REQUIRE_MANIFEST', '1')
    calls = []
    class Api:
        def __init__(self, **kwargs): pass
        def repo_info(self, *args, **kwargs): return SimpleNamespace(sha='a' * 40)
    def download(**kwargs):
        calls.append(kwargs)
        shutil.copytree(source, kwargs['local_dir'])
    monkeypatch.setitem(sys.modules, 'huggingface_hub', SimpleNamespace(HfApi=Api, snapshot_download=download))
    assert fetch_data() == 0
    installed = runtime_directory(root).resolve()
    assert calls[0]['revision'] == 'a' * 40
    assert 'confidence.json' in calls[0]['allow_patterns']
    assert validate_manifest(installed)
    (source / 'graph.json').unlink()
    assert fetch_data() == 0
    assert runtime_directory(root).resolve() == installed
    assert validate_manifest(installed)
    assert not list((root / 'packages').glob('.candidate-*'))
    assert not list(root.glob('.current-*'))


def test_no_manifest_without_strict_mode_is_an_explicit_migration_path(tmp_path, monkeypatch):
    monkeypatch.delenv('HOUND_REQUIRE_MANIFEST', raising=False)
    assert validate_manifest(tmp_path) is None
    monkeypatch.setenv('HOUND_REQUIRE_MANIFEST', '1')
    with pytest.raises(ValueError):
        validate_manifest(tmp_path)


def test_calibration_cli_fits_validation_and_rejects_holdout_leakage(tmp_path, monkeypatch):
    import csv
    from PIL import Image
    from ml.research.calibrate_confidence import main
    data = tmp_path / 'data'
    data.mkdir()
    (data / 'index.npz').write_bytes(b'synthetic')
    (data / 'graph.json').write_text(json.dumps({'nodes': [
        {'id': 'F1_synthetic_a', 'floor': 1, 'x': 0, 'y': 0},
        {'id': 'F2_synthetic_b', 'floor': 2, 'x': 0, 'y': 0}], 'edges': []}))
    (data / 'rooms.json').write_text('[]')
    class Matcher:
        model_name = 'synthetic'
        feature_observer = None
        def locate(self, image):
            correct = image.getpixel((0, 0))[0] > 100
            self.feature_observer(dict(zip(FEATURES, [float(correct), float(correct), .9, .2, 0])))
            return {'spot': 'F1_synthetic_a' if correct else 'F2_synthetic_b', 'floor': 1 if correct else 2}
    monkeypatch.setattr('ml.research.calibrate_confidence.create_backend', lambda *args, **kwargs: Matcher())
    def manifest(name, split, session_prefix, offset):
        rows = []
        for i, color in enumerate([(200 + offset, 0, 0), (0, 0, 200 + offset)]):
            path = tmp_path / f'{name}{i}.png'
            with Image.new('RGB', (32, 32), color) as image:
                image.save(path)
            rows.append({'file': path.name, 'spot': 'F1_synthetic_a',
                         'session': f'{session_prefix}{i}', 'split': split})
        path = tmp_path / f'{name}.csv'
        with path.open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        return path
    validation = manifest('validation', 'validation', 'training', 0)
    config_path = data / 'confidence.json'
    main(['--manifest', str(validation), '--data-dir', str(data), '--output', str(config_path)])
    frozen = config_path.read_bytes()
    holdout = manifest('holdout', 'holdout', 'held', 1)
    output = tmp_path / 'report.json'
    args = ['--manifest', str(holdout), '--data-dir', str(data), '--evaluate', str(config_path), '--output', str(output)]
    main(args)
    assert json.loads(output.read_text())['split'] == 'holdout'
    assert json.loads(output.read_text())['count'] == 2
    assert config_path.read_bytes() == frozen
    # Reusing a fitting session is refused even with different photo bytes.
    holdout.write_text(holdout.read_text().replace('held', 'training'))
    with pytest.raises(SystemExit):
        main(args)
    # Final outsider photos must never be used to fit a new cutoff.
    validation.write_text(validation.read_text().replace('validation0.png', 'TEST_synthetic.png'))
    (tmp_path / 'TEST_synthetic.png').write_bytes((tmp_path / 'validation0.png').read_bytes())
    with pytest.raises(SystemExit):
        main(['--manifest', str(validation), '--data-dir', str(data), '--output', str(config_path)])
    assert config_path.read_bytes() == frozen
