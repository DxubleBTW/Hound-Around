"""Read-only deployed health/CORS/routing checks. Never uploads or corrects photos."""
import argparse
import json
import math
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


def check_service(base_url, origin=None, start=None, destination=None):
    parsed = urlparse(base_url)
    if (parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise ValueError('Use an HTTP(S) API URL without credentials')
    if bool(start) != bool(destination):
        raise ValueError('Supply both the starting node and destination for a route check')
    base = base_url.rstrip('/')

    def get(path):
        request = Request(base + path, headers={'Origin': origin} if origin else {})
        with urlopen(request, timeout=30) as response:
            if origin and response.headers.get('Access-Control-Allow-Origin') != origin:
                raise ValueError('Backend CORS does not allow the supplied frontend origin')
            body = response.read(256 * 1024 + 1)
            if len(body) > 256 * 1024:
                raise ValueError('Unexpectedly large API response')
            result = json.loads(body)
            if not isinstance(result, dict):
                raise ValueError('API response must be an object')
            return result

    health = get('/health')
    if (health.get('ok') is not True or type(health.get('index_size')) is not int
            or health['index_size'] <= 0 or not isinstance(health.get('model'), str)
            or not health['model'] or health['model'].startswith(('stub', 'mock'))):
        raise ValueError('Backend is not ready with a real nonempty recognition index')
    summary = {'ready': True, 'model': health['model'], 'index_size': health['index_size']}
    if start:
        route = get('/route?' + urlencode({'from': start, 'to': destination, 'accessible': 'true'}))
        if (not isinstance(route.get('steps'), list) or type(route.get('total_meters')) not in (int, float)
                or not math.isfinite(route['total_meters']) or route['total_meters'] < 0):
            raise ValueError('Invalid route response')
        summary.update({'accessible_steps': len(route['steps']), 'meters': route['total_meters']})
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--origin')
    parser.add_argument('--from-node')
    parser.add_argument('--to-room')
    parser.add_argument('--wait-seconds', type=float, default=0, help='Retry temporary network/502/503/504 failures while a service wakes')
    args = parser.parse_args(argv)
    if not math.isfinite(args.wait_seconds) or not 0 <= args.wait_seconds <= 120:
        parser.error('wait-seconds must be between 0 and 120')
    deadline = time.monotonic() + args.wait_seconds
    while True:
        try:
            print(json.dumps(check_service(args.url, args.origin, args.from_node, args.to_room)))
            return
        except HTTPError as error:
            if error.fp is not None:
                error.close()
            if error.code not in (502, 503, 504) or time.monotonic() >= deadline:
                parser.error(str(error))
        except (URLError, TimeoutError) as error:
            if time.monotonic() >= deadline:
                parser.error(str(error))
        except (OSError, ValueError) as error:
            parser.error(str(error))
        time.sleep(min(3, max(0, deadline - time.monotonic())))


if __name__ == '__main__':
    main()
