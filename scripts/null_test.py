# Null-tests host renders against device recordings (PLAN.md 4.4).
#
#   mise exec -- uv run --with numpy scripts/null_test.py <device folder> <host folder>
#
# Pairs WAVs by file name, aligns each pair by cross-correlation and reports the null: the level of the difference
# relative to the device's signal, so -60 dB means it's 60 dB quieter. Lengths can differ: stem export renders past a
# clip's end for as long as the CPU takes.
import pathlib
import struct
import sys

import numpy as np

MAX_LAG = 4096


def read(path):
    data = path.read_bytes()
    pos = 12
    while pos + 8 <= len(data):
        chunk, size = data[pos : pos + 4], struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        if chunk == b"fmt ":
            channels, bits = struct.unpack("<H", data[pos + 10 : pos + 12])[0], struct.unpack("<H", data[pos + 22 : pos + 24])[0]
        if chunk == b"data":
            raw = np.frombuffer(data[pos + 8 : pos + 8 + size], np.uint8)
        pos += 8 + size + (size & 1)
    if bits != 24:
        sys.exit(f"{path}: {bits}-bit, expected 24")
    b = raw.reshape(-1, 3).astype(np.int32)
    samples = b[:, 0] | b[:, 1] << 8 | b[:, 2] << 16
    samples = np.where(samples >= 1 << 23, samples - (1 << 24), samples)
    return samples.reshape(-1, channels).astype(np.float64)


def db(ratio):
    return 20 * np.log10(max(ratio, 1e-12))


def compare(device_path, host_path):
    device, host = read(device_path), read(host_path)
    if device.shape[1] != host.shape[1]:
        return f"{device.shape[1]} channels on the device, {host.shape[1]} on the host"
    # Host lag, in frames, that best lines it up with the device, by the first channel.
    n = min(len(device), len(host)) - MAX_LAG
    padded = np.pad(host[:, 0], (MAX_LAG, MAX_LAG))
    window = device[:n, 0]
    lags = np.arange(-MAX_LAG, MAX_LAG + 1)
    correlation = [np.dot(padded[MAX_LAG + lag : MAX_LAG + lag + n], window) for lag in lags]
    lag = int(lags[np.argmax(correlation)])
    start = max(0, -lag)
    length = min(len(device) - start, len(host) - start - lag)
    d = device[start : start + length]
    h = host[start + lag : start + lag + length]
    signal = np.sqrt(np.mean(d**2))
    residual = np.sqrt(np.mean((h - d) ** 2))
    return (
        f"{len(device)} frames on the device, {len(host)} on the host, lag {lag}: "
        f"signal {db(signal / 2**23):.1f} dBFS, null {db(residual / signal):+.1f} dB, "
        f"{np.mean(h == d) * 100:.0f}% of samples identical"
    )


def main():
    if len(sys.argv) != 3:
        sys.exit("Usage: null_test.py <device folder> <host folder>")
    device_folder, host_folder = map(pathlib.Path, sys.argv[1:])
    for device_path in sorted(device_folder.glob("*.[wW][aA][vV]")):
        host_path = host_folder / device_path.name
        result = compare(device_path, host_path) if host_path.exists() else "no host render"
        print(f"{device_path.name}: {result}")


main()
