// SPDX-License-Identifier: GPL-2.0-or-later
// Replacement for the sigc++ signals of upstream.

/** A list of callbacks. connect() returns a function that disconnects the callback. */
export class Signal<Args extends unknown[]> {
  #slots: ((...args: Args) => void)[] = [];

  connect(slot: (...args: Args) => void): () => void {
    this.#slots.push(slot);
    return () => {
      const i = this.#slots.indexOf(slot);
      if (i >= 0) this.#slots.splice(i, 1);
    };
  }

  emit(...args: Args): void {
    // Copy: a slot may disconnect itself or others while it runs.
    for (const slot of [...this.#slots]) slot(...args);
  }

  empty(): boolean {
    return this.#slots.length === 0;
  }
}
