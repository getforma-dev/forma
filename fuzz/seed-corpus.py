"""Copy frozen format fixtures into each target's proper input representation."""
from pathlib import Path
import shutil
p = Path(__file__).resolve().parent
fixtures = p.parent / "crates/forma-ir/tests/fixtures"
for target in ("parse_raw", "parse_body", "parse_mutated", "walk"):
    output = p / "corpus" / target
    output.mkdir(parents=True, exist_ok=True)
    for seed in sorted((p / "regressions" / target).iterdir()):
        if seed.is_file():
            shutil.copy2(seed, output / ("regression-" + seed.name))
    for source in ("js-emitter", "fmir-v3"):
        for seed in sorted((fixtures / source).glob("*.ir")):
            data = seed.read_bytes()
            if target == "parse_body":
                data = data[24:]
            elif target == "walk":
                data = len(data).to_bytes(4, "little") + data
            elif target == "parse_mutated":
                continue
            (output / (source + "-" + seed.stem)).write_bytes(data)
    if target == "parse_mutated":
        for index in range(14):
            (output / f"seed-{index:02}").write_bytes(bytes([index]))
print("Seeded all four adapters from frozen fixtures and regression inputs.")
