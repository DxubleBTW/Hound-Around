import sys
from pathlib import Path
from types import SimpleNamespace

from scripts import fetch_data


def test_runtime_data_downloads_use_one_pinned_revision(tmp_path, monkeypatch):
    from test_runtime_artifacts import package
    snapshots, resolutions = [], []
    monkeypatch.setenv('HOUND_DATA_REPO', 'example/private-data')
    monkeypatch.setenv('HF_TOKEN', 'test-only')
    monkeypatch.setenv('HOUND_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('HOUND_DATA_REVISION', 'pinned-dataset-commit')
    class Api:
        def __init__(self, **kwargs): pass
        def repo_info(self, *args, **kwargs):
            resolutions.append(kwargs['revision'])
            return SimpleNamespace(sha='a' * 40)
    def download(**kwargs):
        snapshots.append(kwargs)
        package(Path(kwargs['local_dir']))
    monkeypatch.setitem(sys.modules, 'huggingface_hub', SimpleNamespace(HfApi=Api, snapshot_download=download))
    assert fetch_data.main() == 0
    assert resolutions == ['pinned-dataset-commit']
    assert len(snapshots) == 1
    assert snapshots[0]['revision'] == 'a' * 40
    assert (tmp_path / 'current' / 'runtime-manifest.json').is_file()
