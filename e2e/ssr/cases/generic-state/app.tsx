// The 3.0.0 entry shape (FORMA-105, DR-6): the compiler selects Page through
// the standalone mount and removes it from the server-rendered route's browser
// product, which activates Counter alone; the explicit Browser build (/csr)
// keeps the mount and its own zero default.
import { mount, activateIslands } from '@getforma/core';
import { Page, Counter } from './page';

activateIslands({ Counter });
mount(() => Page({ count: 0 }), '#app');
