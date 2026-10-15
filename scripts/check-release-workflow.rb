# frozen_string_literal: true

# SR13/SR43: lint a deliberately narrow release pipeline. Credential jobs have an exact
# command allowlist, so a check in dead code/after exit/in a function cannot masquerade as
# a gate. The first-party publish helper has separate tests; no dependency code is installed.
require 'yaml'

WORKFLOW = '.github/workflows/release.yml'
PUBLISH = { 'publish-crates' => 'crates', 'publish-npm' => 'npm' }.freeze
VERIFY = 'bash scripts/release-artifacts.sh verify "$RUNNER_TEMP/release" "$RECORD_SHA256"'
NEEDS = {
  'check' => [], 'pack' => ['check'], 'verify' => %w[check pack],
  'publish-crates' => %w[check pack verify], 'publish-npm' => %w[check pack verify publish-crates],
  'record' => %w[check pack verify publish-crates publish-npm]
}.freeze
ACTIONS = %w[actions/checkout actions/setup-node actions/download-artifact dtolnay/rust-toolchain rust-lang/crates-io-auth-action].freeze

def steps(job)
  job.is_a?(Hash) && job['steps'].is_a?(Array) ? job['steps'] : []
end

def action(step)
  step.fetch('uses', '').split('@').first.to_s
end

def violations(doc)
  out = []
  return ['W0 workflow must be a mapping'] unless doc.is_a?(Hash)
  out << 'T1 only v* tag pushes may trigger releases' unless doc['on'] == { 'push' => { 'tags' => ['v*'] } }
  out << 'T2 publishing must never cancel another run' unless doc.dig('concurrency', 'cancel-in-progress') == false
  jobs = doc.fetch('jobs', {})
  return out + ['J1 exact six-job release pipeline required'] unless jobs.is_a?(Hash) && jobs.keys.sort == NEEDS.keys.sort
  out << 'P1 top-level permissions are forbidden' if doc.key?('permissions')
  [doc, *jobs.values].each do |holder|
    shell = holder.dig('defaults', 'run', 'shell')
    out << 'E5 only fail-fast default shells allowed' if shell && !%w[bash sh].include?(shell)
  end
  jobs.each do |name, job|
    out << "J2 #{name} dependency graph changed" unless Array(job['needs']).sort == NEEDS[name].sort
    want = if PUBLISH.key?(name)
             { 'contents' => 'read', 'id-token' => 'write' }
           elsif name == 'record'
             { 'contents' => 'write' }
           elsif name == 'check'
             { 'contents' => 'read', 'actions' => 'read' }
           else
             { 'contents' => 'read' }
           end
    out << "P2 #{name} permissions differ from least privilege" unless job['permissions'] == want
    out << "E1 #{name} must fail closed" if job.key?('continue-on-error') || job.key?('container') || job.key?('services') || job.key?('uses')
    out << "E2 #{name} cannot skip a gate" if job.key?('if') && !PUBLISH.key?(name)
    steps(job).each do |step|
      out << "E1 #{name} step must fail closed" if step.key?('continue-on-error') || step.key?('if')
      out << "E5 #{name} shell must fail fast" if step.key?('shell') && !%w[bash sh].include?(step['shell'])
      if step['uses']
        out << "S3 #{name} action must be SHA-pinned" unless step['uses'].match?(%r{\A[\w-]+/[\w./-]+@[a-f0-9]{40}\z})
      end
      if action(step) == 'actions/setup-node'
        out << "N1 #{name} must use the declared build Node with caching off" unless step.dig('with', 'node-version-file') == '.node-version' && step.dig('with', 'package-manager-cache') == false && !step.fetch('with', {}).key?('cache')
      end
      out << 'S21 client_payload cannot enter a shell script' if step.fetch('run', '').include?('client_payload')
    end
  end
  PUBLISH.each do |name, registry|
    job = jobs[name]
    out << "J3 #{name} requires exactly its tag condition (no status functions)" unless job['if'] == "startsWith(github.ref, 'refs/tags/v')"
    out << "J4 #{name} registry environment missing or changed" unless job['environment'] == "#{registry}-publish"
    out << "R1 #{name} must use the hosted runner" unless job['runs-on'] == 'ubuntu-latest'
    runs = steps(job).map { |s| s['run'] }.compact
    expected = [VERIFY, "node scripts/release-publish.mjs \"$RUNNER_TEMP/release\" #{registry}"]
    out << "E4 #{name} checks/publish must be the exact complete step, no other command or dependency code" unless runs == expected
    steps(job).each do |step|
      a = action(step)
      out << "D1 #{name} unapproved action #{a}" unless a.empty? || ACTIONS.include?(a)
      opts = step.fetch('with', {})
      out << "C1 #{name} must restore no cache" if a.match?(/cache/i) || opts.key?('cache')
      if a == 'actions/checkout'
        out << "D4 #{name} checkout must be this tagged commit without credentials" unless opts == { 'persist-credentials' => false }
      end
      if a == 'dtolnay/rust-toolchain'
        out << 'D6 repack uses exactly the pack toolchain' unless opts == { 'toolchain' => '1.93.1' }
      end
      if a == 'actions/download-artifact'
        want = { 'name' => 'release-packed', 'path' => '${{ runner.temp }}/release', 'digest-mismatch' => 'error' }
        out << "A1 #{name} may download only this run's DS11" unless opts == want
      end
    end
    download = steps(job).index { |s| action(s) == 'actions/download-artifact' }
    checks = steps(job).each_index.select { |i| steps(job)[i]['run'] == VERIFY }
    out << "A2 #{name} needs one download then the anchored artifact check" unless download && checks.length == 1 && download < checks.first && steps(job)[checks.first].dig('env', 'RECORD_SHA256') == '${{ needs.pack.outputs.record-sha256 }}'
    expected_actions = %w[actions/checkout actions/setup-node]
    expected_actions << 'dtolnay/rust-toolchain' if registry == 'crates'
    expected_actions << 'actions/download-artifact'
    expected_actions << 'rust-lang/crates-io-auth-action' if registry == 'crates'
    out << "D1 #{name} action sequence changed" unless steps(job).map { |s| action(s) }.reject(&:empty?) == expected_actions
  end
  required = {
    'check' => 'node scripts/check-release-ci.mjs',
    'pack' => 'node scripts/release-set.mjs pack "$RUNNER_TEMP/release"',
    'verify' => 'bash scripts/check-advisories.sh',
    'record' => 'node scripts/release-record.mjs "$RUNNER_TEMP/release" "$RUNNER_TEMP/p17/p17.json"'
  }
  required.each { |name, line| out << "K1 #{name} missing mandatory gate" unless steps(jobs[name]).any? { |s| s['run'] == line } }
  %w[pack verify].each do |name|
    out << "K2 #{name} must install locked dependencies with scripts off" unless steps(jobs[name]).any? { |s| s['run'] == 'bash scripts/install-deps.sh' }
    steps(jobs[name]).each do |s|
      out << "C1 #{name} must restore no cache" if action(s).match?(/cache/i) || s.fetch('with', {}).key?('cache')
    end
    upload = steps(jobs[name]).find { |s| action(s) == 'actions/upload-artifact' }
    expected_name = name == 'pack' ? 'release-packed' : 'release-p17'
    out << "K3 #{name} upload must overwrite this run's artifact" unless upload && upload.dig('with', 'name') == expected_name && upload.dig('with', 'overwrite') == true && upload.dig('with', 'if-no-files-found') == 'error'
  end
  out << 'K4 pack must consume committed locks (no fresh resolution)' if steps(jobs['pack']).any? { |s| s.fetch('run', '').match?(/generate-lockfile|npm\s+install/) }
  out << 'K5 P17 must run before publishing' unless steps(jobs['verify']).any? { |s| s.fetch('run', '').lines.map(&:strip).include?('node scripts/verify-release-set.mjs "$RUNNER_TEMP/release" "$RUNNER_TEMP/p17/p17.json"') }
  out
end

doc = YAML.safe_load(File.read(WORKFLOW), aliases: false)
doc['on'] = doc.delete(true) if doc.is_a?(Hash) && doc.key?(true)
errors = violations(doc)
if ARGV.include?('--self-test') && errors.empty?
  seeds = [
    ['branch trigger', 'T1', ->(d) { d['on']['push']['branches'] = ['main'] }],
    ['dispatch trigger', 'T1', ->(d) { d['on']['workflow_dispatch'] = nil }],
    ['cancelling release', 'T2', ->(d) { d['concurrency']['cancel-in-progress'] = true }],
    ['new ungated job', 'J1', ->(d) { d['jobs']['other'] = {} }],
    ['OIDC on pack', 'P2', ->(d) { d['jobs']['pack']['permissions']['id-token'] = 'write' }],
    ['global OIDC', 'P1', ->(d) { d['permissions'] = 'write-all' }],
    ['missing P17 dependency', 'J2', ->(d) { d['jobs']['publish-npm']['needs'].delete('verify') }],
    ['npm before crates', 'J2', ->(d) { d['jobs']['publish-npm']['needs'].delete('publish-crates') }],
    ['missing environment', 'J4', ->(d) { d['jobs']['publish-npm'].delete('environment') }],
    ['success status function', 'J3', ->(d) { d['jobs']['publish-npm']['if'] = "success() || startsWith(github.ref, 'refs/tags/v')" }],
    ['always status function', 'J3', ->(d) { d['jobs']['publish-crates']['if'] = 'always()' }],
    ['permissive default shell', 'E5', ->(d) { d['defaults'] = { 'run' => { 'shell' => 'bash {0}' } } }],
    ['dependency install before subcommand', 'E4', ->(d) { d['jobs']['publish-npm']['steps'] << { 'run' => 'npm -g install foo' } }],
    ['cargo toolchain before subcommand', 'E4', ->(d) { d['jobs']['publish-crates']['steps'] << { 'run' => 'cargo +stable build' } }],
    ['publish cache', 'D1', ->(d) { d['jobs']['publish-npm']['steps'] << { 'uses' => 'actions/cache@' + 'a' * 40 } }],
    ['pack cache', 'C1', ->(d) { d['jobs']['pack']['steps'] << { 'uses' => 'actions/cache@' + 'a' * 40 } }],
    ['a status failure ignored', 'E1', ->(d) { d['jobs']['verify']['continue-on-error'] = true }],
    ['skip P17', 'E2', ->(d) { d['jobs']['verify']['if'] = 'false' }],
    ['missing live CI check', 'K1', ->(d) { d['jobs']['check']['steps'].reject! { |s| s['run'] == 'node scripts/check-release-ci.mjs' } }],
    ['no release record', 'K1', ->(d) { d['jobs']['record']['steps'].reject! { |s| s['run'] } }]
  ]
  ['if false; then CHECK; fi', 'exit 0\nCHECK', 'f() { CHECK; }', 'CHECK || true', '"set" +e\nCHECK'].each do |wrapper|
    seeds << ["hidden check: #{wrapper}", 'E4', lambda { |d| d['jobs']['publish-npm']['steps'].find { |s| s['run'] == VERIFY }['run'] = wrapper.gsub('CHECK', VERIFY).gsub('\\n', "\n") }]
  end
  seeds << ['artifact from another run', 'A1', lambda { |d| d['jobs']['publish-npm']['steps'].find { |s| action(s) == 'actions/download-artifact' }['with']['run-id'] = '123' }]
  seeds << ['replaced hash anchor', 'A2', lambda { |d| d['jobs']['publish-npm']['steps'].find { |s| s['run'] == VERIFY }['env']['RECORD_SHA256'] = 'artifact supplied hash' }]
  seeds.each do |name, rule, mutate|
    seeded = Marshal.load(Marshal.dump(doc)); mutate.call(seeded)
    errors << "self-test failed to reject #{name} with #{rule}" unless violations(seeded).any? { |v| v.start_with?(rule) }
  end
  puts "#{seeds.length} SR13/SR43 seeded violations rejected" if errors.empty?
  errors << 'release helper tests failed' unless system('node', '--test', 'scripts/release.test.mjs')
end
abort(errors.join("\n")) unless errors.empty?
puts 'release workflow: tag → exact CI → locked pack → P17 → crates → npm → record; credential jobs constrained'
