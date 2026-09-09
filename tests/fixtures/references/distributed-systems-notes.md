# Distributed Systems Notes

The CAP theorem says a system that partitions cannot be both consistent and available during the partition. Partitions are not optional, so the real choice is what to do when one happens: refuse requests and stay consistent, or serve possibly stale data and stay available. Framing CAP as picking two of three obscures that the decision is made per operation, not once for the whole system.

Consensus protocols exist to make a group of machines agree on an ordered log despite failures. Raft decomposes the problem into leader election, log replication, and safety, and it is popular mainly because that decomposition is teachable. A leader accepts writes, replicates them to followers, and commits an entry once a majority have persisted it. The majority quorum is what makes two conflicting leaders unable to both commit.

Exactly-once delivery does not exist at the network layer. What systems actually provide is at-least-once delivery plus idempotent processing, which produces exactly-once effects. The idempotency key has to be chosen by the producer and stored by the consumer for long enough to cover the retry window, and getting that retention wrong is a quiet source of duplicate side effects months later.

Clock skew makes wall-clock timestamps unsafe for ordering events across machines. Logical clocks order causally related events without any physical time, and vector clocks additionally detect concurrency. Hybrid logical clocks combine a physical component with a logical counter, which keeps timestamps close to real time while preserving causality, and that is why several databases adopted them for multi-region deployments.

Backpressure is the mechanism a system uses to tell an upstream producer to slow down. Without it, a queue grows until memory runs out or latency becomes indistinguishable from failure. Bounded queues that reject or block are less pleasant than unbounded ones right up until the moment they save the service.
