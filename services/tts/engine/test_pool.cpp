// A worker thread that starts after the first run() (or after the destructor began) must still take
// that job. Several threads make pools at once, so new workers often wait for a core and start late;
// before the fix this hung within the first few pools.
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <thread>
#include <vector>

#include "pool.h"

int main() {
  const int drivers = 2 * std::max(2u, std::thread::hardware_concurrency()), pools = 300;
  std::atomic<long> sum{0};
  std::vector<std::thread> ts;
  for (int d = 0; d < drivers; d++)
    ts.emplace_back([&] {
      for (int it = 0; it < pools; it++) {
        pk::Pool p(2 + it % 3);
        if (it % 4 == 3) continue;  // destroyed before its workers may have started
        p.run(8, [&](int i) { sum += i; });
        p.run(3, [&](int i) { sum += i; });
      }
    });
  for (auto& t : ts) t.join();
  const long want = long(drivers) * (pools - pools / 4) * (28 + 3);
  if (sum != want) return std::printf("pool: sum %ld, want %ld\n", sum.load(), want), 1;
  std::printf("pool: ok\n");
}
