#!/usr/bin/env python3
"""
check_begriffe.py
-----------------
Begriffs-Gate: bricht ab, wenn ein beschlossen-toter Begriff wieder in
Quellcode oder aktueller Doku auftaucht.

Der Anlass, 06.08.2026: ein Einsatzbereich wurde in Notion umbenannt, und die
Suche danach förderte drei gleichzeitig gültige Schreibweisen in drei Repos
zutage. Ein Issue stand auf "Bereit", das die Website auf die mittlere,
inzwischen ungültige Form gezogen hätte. Solche Nachzieh-Schulden findet man
sonst erst, wenn sie schon eingebaut sind.

Was hier NICHT passiert: das Gate entscheidet nichts. Es hält nur fest, was
schon entschieden ist. Wer die Nachbar-Repos informiert, ist eine andere Frage.

Gelesen wird `.verbotene-begriffe` im Repo-Wurzelverzeichnis; das Format
erklärt die Datei selbst.

Geprüft werden ausschließlich versionierte Dateien (`git ls-files`). Das ist
Absicht und keine Bequemlichkeit: Build-Ausgaben wie out/ oder node_modules/
sind ignoriert und würden das Ergebnis sonst um Tausende Scheintreffer
verwässern. Im Website-Repo waren es 6.000 auf einen einzigen Begriff.

Aufruf:
    python3 scripts/check_begriffe.py              # ganzes Repo
    python3 scripts/check_begriffe.py PFAD [PFAD…] # nur diese Pfade
    python3 scripts/check_begriffe.py --liste DATEI

Exit-Codes: 0 sauber, 1 Treffer, 2 die Prüfung selbst kam nicht zustande.
Der Unterschied zwischen 1 und 2 ist wichtig: ein Gate, das wegen eines
kaputten Aufrufs still 0 zurückgibt, meldet Sauberkeit, die es nie geprüft hat.
"""

import fnmatch
import re
import subprocess
import sys
from pathlib import Path

LISTE_NAME = ".verbotene-begriffe"
MARKER_ZEILE = "begriffe-gate:ok"
MARKER_DATEI = "begriffe-gate:historisch"
MARKER_KOPFZEILEN = 20
REGEX_PRAEFIX = "re:"
GLOB_ZEICHEN = set("*?[")


class Konfigfehler(Exception):
    """Die Liste ist unlesbar oder leer. Führt zu Exit 2, nie zu Exit 0."""


def repo_wurzel(start=None):
    start = Path(start or Path(__file__).resolve().parent.parent)
    try:
        out = subprocess.run(
            ["git", "-C", str(start), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise Konfigfehler(
            f"Kein Git-Repository unter {start} (oder git fehlt): {e}") from e
    return Path(out)


def lade_liste(pfad):
    """Liest die Liste und gibt (begriffe, ausnahmen) zurück.

    begriffe ist eine Liste von (anzeige, sucher); sucher(zeile) -> bool.
    """
    if not pfad.exists():
        raise Konfigfehler(f"{pfad} fehlt. Ohne Liste prüft das Gate nichts.")

    begriffe, ausnahmen = [], []
    ziel = begriffe
    for nr, roh in enumerate(pfad.read_text(encoding="utf-8").splitlines(), 1):
        zeile = roh.strip()
        if not zeile or zeile.startswith("#"):
            continue
        if zeile.startswith("[") and zeile.endswith("]"):
            name = zeile[1:-1].strip().lower()
            if name == "begriffe":
                ziel = begriffe
            elif name == "ausnahmen":
                ziel = ausnahmen
            else:
                raise Konfigfehler(f"{pfad}:{nr}: unbekannte Sektion {zeile!r}")
            continue
        if ziel is ausnahmen:
            ausnahmen.append(zeile)
            continue
        if zeile.startswith(REGEX_PRAEFIX):
            muster = zeile[len(REGEX_PRAEFIX):].strip()
            try:
                kompiliert = re.compile(muster)
            except re.error as e:
                raise Konfigfehler(f"{pfad}:{nr}: kaputter Ausdruck {muster!r}: {e}") from e
            begriffe.append((zeile, kompiliert.search))
        else:
            begriffe.append((zeile, lambda z, t=zeile: t in z))

    if not begriffe:
        raise Konfigfehler(f"{pfad} enthält keinen einzigen Begriff.")
    return begriffe, ausnahmen


def ausgenommen(relpfad, ausnahmen):
    """Ausnahmen greifen auf ganzen Pfadsegmenten, nicht auf Zeichenpräfixen.

    Sonst nähme "data/snapshots/" auch "data/snapshots-alt/" mit heraus, und
    eine Ausnahme, die mehr ausnimmt als sie sagt, ist ein blinder Fleck.
    Wer unscharf braucht, schreibt ein Glob-Muster hin.
    """
    s = relpfad.as_posix()
    for muster in ausnahmen:
        m = muster.rstrip("/")
        # Erst wörtlich. Next.js-Repos haben Pfade wie app/[lang]/dictionaries/,
        # und als Glob gelesen wäre "[lang]" eine Zeichenklasse, die genau
        # diesen Pfad nicht trifft. Wörtlich zuerst heißt: ein Pfad, den man
        # hinschreibt, bedeutet auch das, was dasteht.
        if s == m or s.startswith(m + "/"):
            return True
        if GLOB_ZEICHEN & set(muster) and (
                fnmatch.fnmatch(s, muster) or fnmatch.fnmatch(s, m + "/*")):
            return True
    return False


def versionierte_dateien(wurzel, pfade=None):
    cmd = ["git", "-C", str(wurzel), "ls-files", "-z"]
    if pfade:
        cmd += ["--"] + [str(p) for p in pfade]
    try:
        out = subprocess.run(cmd, capture_output=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise Konfigfehler(f"git ls-files fehlgeschlagen: {e}") from e
    return [Path(n) for n in out.decode("utf-8").split("\0") if n]


def pruefe_datei(voll, rel, begriffe):
    """Treffer in einer Datei als Liste von (zeilennr, anzeige, textauszug).

    Nicht-UTF-8-Dateien (Bilder, PDFs, xlsx) werden übersprungen; sie tragen
    keine Begriffe, die jemand pflegen könnte.
    """
    try:
        text = voll.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []

    zeilen = text.splitlines()
    if any(MARKER_DATEI in z for z in zeilen[:MARKER_KOPFZEILEN]):
        return []

    treffer = []
    for nr, zeile in enumerate(zeilen, 1):
        if MARKER_ZEILE in zeile:
            continue
        # HTML-Entities zurückübersetzen, sonst rutscht "A &amp; B" durch,
        # obwohl auf der gerenderten Seite "A & B" steht.
        norm = zeile.replace("&amp;", "&")
        for anzeige, sucht in begriffe:
            if sucht(norm):
                treffer.append((nr, anzeige, zeile.strip()[:120]))
    return treffer


def main(argv):
    liste_pfad = None
    pfade = []
    i = 0
    while i < len(argv):
        if argv[i] == "--liste":
            if i + 1 >= len(argv):
                print("--liste braucht einen Pfad.", file=sys.stderr)
                return 2
            liste_pfad = Path(argv[i + 1])
            i += 2
        else:
            pfade.append(argv[i])
            i += 1

    try:
        wurzel = repo_wurzel()
        begriffe, ausnahmen = lade_liste(liste_pfad or wurzel / LISTE_NAME)
        dateien = versionierte_dateien(wurzel, pfade or None)
    except Konfigfehler as e:
        print(f"FEHLER: {e}", file=sys.stderr)
        return 2

    treffer = []
    geprueft = 0
    for rel in dateien:
        if ausgenommen(rel, ausnahmen):
            continue
        geprueft += 1
        for nr, anzeige, auszug in pruefe_datei(wurzel / rel, rel, begriffe):
            treffer.append((rel.as_posix(), nr, anzeige, auszug))

    if not treffer:
        print(f"Begriffs-Gate grün: {len(begriffe)} Begriffe gegen "
              f"{geprueft} versionierte Dateien geprüft.")
        return 0

    print(f"Begriffs-Gate rot: {len(treffer)} Treffer in {geprueft} "
          f"geprüften Dateien.\n", file=sys.stderr)
    for datei, nr, anzeige, auszug in treffer:
        print(f"  {datei}:{nr}: {anzeige}", file=sys.stderr)
        print(f"      {auszug}", file=sys.stderr)
    print(f"\nEntweder der Begriff wird nachgezogen, oder die Stelle trägt "
          f"Historie.\nDann: '{MARKER_ZEILE}' mit Begründung an die Zeile, "
          f"'{MARKER_DATEI}' in den Kopf der Datei,\noder einen Pfad in die "
          f"Sektion [ausnahmen] von {LISTE_NAME}.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
