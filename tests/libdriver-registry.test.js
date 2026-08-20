const test = require("node:test");
const assert = require("node:assert/strict");

const registry = require("../libdriver-registry.js");
const drivers = require("../alice-drivers.js");

test("libdriver registry collects more than 150 useful upstream repositories", () => {
  const entries = registry.list();
  assert.equal(registry.publicRepositoryCount, 181);
  assert.ok(entries.length >= 150);
  assert.equal(entries.length, registry.usefulCount);
  assert.equal(new Set(entries.map((entry) => entry.repository)).size, entries.length);
  entries.forEach((entry) => {
    assert.equal(entry.attribution, "libdriver 制作 · 待 AliceSIM 适配");
    assert.equal(entry.upstream.license, "MIT");
    assert.equal(entry.upstream.url, `https://github.com/libdriver/${entry.repository}`);
    assert.equal(entry.installable, false);
    assert.equal(entry.status, "upstream");
  });
});

test("upstream registry is grouped into useful peripheral categories", () => {
  const categories = registry.categories();
  assert.deepEqual(categories.map((category) => category.id), [
    "environment", "motion", "measurement", "storage", "display", "communication", "media"
  ]);
  assert.equal(categories.reduce((total, category) => total + category.count, 0), registry.usefulCount);
  assert.equal(registry.find("w25qxx").featured, true);
  assert.equal(registry.find("libdriver-mpu6050").stars, 421);
});

test("driver manager candidates omit repositories already represented by AliceSIM components", () => {
  const candidates = drivers.upstreamCandidates();
  const repositories = new Set(candidates.map((entry) => entry.repository));
  assert.ok(candidates.length >= 150);
  assert.equal(repositories.has("ssd1306"), false);
  assert.equal(repositories.has("dht11"), false);
  assert.equal(repositories.has("bmp280"), false);
  assert.equal(repositories.has("w25qxx"), false);
  assert.equal(repositories.has("st7789"), true);
  assert.equal(drivers.upstreamCategories().length, 7);
});
