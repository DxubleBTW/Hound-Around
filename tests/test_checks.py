"""The repository guard and read-only smoke checker must fail usefully."""
from io import BytesIO
import json

import pytest

from scripts.check_private_files import violations
from scripts.smoke_backend import check_service


def test_known_private_artifacts_are_rejected_even_if_forced_into_git():
    paths = ['data/labels.csv', 'nested/graph.json', 'PUBLIC/Photo.JPG', 'saved/index.npz', '.env.production',
             'private-plan.PDF', 'state/corrections.sqlite-wal', 'state/corrections.sqlite-shm']
    assert violations(paths) == paths
    assert violations(['frontend/public/favicon.svg', 'docs/img/diagram.png', 'frontend/.env.example', 'api/main.py']) == []


class Response(BytesIO):
    def __init__(self, payload, origin='https://app.example'):
        super().__init__(json.dumps(payload).encode())
        self.headers = {'Access-Control-Allow-Origin': origin}


def test_smoke_checks_real_readiness_and_accessible_route_shape(monkeypatch):
    requests = []
    def open_request(request, timeout):
        requests.append(request.full_url)
        if request.full_url.endswith('/health'):
            return Response({'ok':True,'model':'test-model','index_size':10})
        return Response({'steps':[], 'total_meters':0})
    monkeypatch.setattr('scripts.smoke_backend.urlopen', open_request)
    result = check_service('https://api.example', 'https://app.example', 'F1_a', 'TEST')
    assert result['index_size'] == 10
    assert result['accessible_steps'] == 0
    assert 'accessible=true' in requests[-1]
    assert all('/correct' not in url and '/locate' not in url for url in requests)


def test_smoke_does_not_accept_stub_as_production_ready(monkeypatch):
    monkeypatch.setattr('scripts.smoke_backend.urlopen', lambda *args,**kwargs: Response({'ok':True,'model':'stub-test','index_size':10}))
    with pytest.raises(ValueError, match='real nonempty'):
        check_service('https://api.example')


def test_smoke_reports_wrong_cors_origin(monkeypatch):
    monkeypatch.setattr('scripts.smoke_backend.urlopen', lambda *args,**kwargs: Response({},origin='https://wrong.example'))
    with pytest.raises(ValueError, match='CORS'):
        check_service('https://api.example','https://app.example')


def test_smoke_retries_a_sleeping_service_without_hiding_permanent_errors(monkeypatch, capsys):
    from urllib.error import HTTPError
    from scripts.smoke_backend import main
    attempts = []
    def open_request(*args, **kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise HTTPError('https://api.example/health', 503, 'warming', {}, None)
        return Response({'ok':True,'model':'test-model','index_size':10})
    monkeypatch.setattr('scripts.smoke_backend.urlopen', open_request)
    monkeypatch.setattr('scripts.smoke_backend.time.sleep', lambda seconds: None)
    main(['--url','https://api.example','--wait-seconds','1'])
    assert len(attempts) == 2
    assert json.loads(capsys.readouterr().out)['ready'] is True
