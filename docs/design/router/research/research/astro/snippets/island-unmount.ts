// Verbatim upstream excerpt: Astro astro@7.2.10
// Source: https://github.com/withastro/astro/blob/2fdf731428aa738d5dcf3041b4e78eb9d036968c/packages/astro/src/runtime/server/astro-island.ts#L266-L269
// Original lines 266-269; context omitted. Not standalone executable code.
// License: MIT and supplied notices; see ../licenses/framework-LICENSE.txt.

		unmount = () => {
			// If element wasn't persisted, fire unmount event
			if (!this.isConnected) this.dispatchEvent(new CustomEvent('astro:unmount'));
		};
