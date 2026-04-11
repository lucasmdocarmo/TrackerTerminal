#pragma once
#include <cstring> // for strerror
#include <iostream>
#include <thread>
#include <vector>

// Platform-specific headers
#ifdef __linux__
#include <pthread.h>
#include <sched.h>
#elif defined(__APPLE__)
#include <mach/thread_act.h>
#include <mach/thread_policy.h>
#endif

namespace quant {

class ThreadUtils {
public:
  // Pin the current thread to a specific CPU core
  static void pinThread(int core_id) {
#ifdef __linux__
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(core_id, &cpuset);

    pthread_t current_thread = pthread_self();
    int rc = pthread_setaffinity_np(current_thread, sizeof(cpu_set_t), &cpuset);
    if (rc != 0) {
      std::cerr << "Error calling pthread_setaffinity_np: " << rc << std::endl;
    } else {
      std::cout << "Thread pinned to core " << core_id << std::endl;
    }
#elif defined(__APPLE__)
    // macOS doesn't support strict pinning like Linux, but we can give affinity
    // hints. This tells the scheduler "run this thread on a core with affinity
    // tag X". Threads with the same tag share L2 cache. Threads with different
    // tags might rarely migrate.

    thread_affinity_policy_data_t policy = {core_id};
    thread_port_t mach_thread = pthread_mach_thread_np(pthread_self());
    kern_return_t ret = thread_policy_set(mach_thread, THREAD_AFFINITY_POLICY,
                                          (thread_policy_t)&policy,
                                          THREAD_AFFINITY_POLICY_COUNT);
    if (ret != KERN_SUCCESS) {
      std::cerr << "Error setting thread affinity: " << ret << std::endl;
    } else {
      std::cout << "Thread affinity set to tag " << core_id << " (macOS hint)"
                << std::endl;
    }
#else
    std::cerr << "Thread pinning not supported on this OS." << std::endl;
#endif
  }

  // Set thread name for easier debugging (htop/top)
  static void setThreadName(const std::string &name) {
#ifdef __linux__
    pthread_setname_np(pthread_self(), name.substr(0, 15).c_str());
#elif defined(__APPLE__)
    pthread_setname_np(name.c_str());
#endif
  }
};

} // namespace quant
