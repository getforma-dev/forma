# frozen_string_literal: true

# SR13/SR43: lint a deliberately narrow release pipeline. Credential jobs have an exact
# command allowlist, so a check in dead code/after exit/in a function cannot masquerade as
# a gate. The first-party publish helper has separate tests; no dependency code is installed.
require 'yaml'
require 'json'

WORKFLOW = '.github/workflows/release.yml'
# The contract file states which tickets gate which milestone; the scripts refuse a
# milestone whose gates (or an earlier milestone's) are open. The lint keeps that
# statement well-formed: no global switch can stand in for the per-milestone gates.
CONTRACTS = 'scripts/release-contracts.json'
MILESTONES = %w[alpha beta rc final].freeze
GATE_KEY = %r{\AFORMA-\d{3}( [A-Za-z0-9()./-]+)*\z}.freeze
PUBLISH = { 'publish-crates' => 'crates', 'publish-npm' => 'npm' }.freeze
VERIFY = 'bash scripts/release-artifacts.sh verify "$RUNNER_TEMP/release" "$RECORD_SHA256"'
NEEDS = {
  'check' => [], 'engines' => ['check'], 'pack' => ['check'], 'verify' => %w[check pack],
  'publish-crates' => %w[check pack engines verify], 'publish-npm' => %w[check pack engines verify publish-crates],
  'record' => %w[check pack engines verify publish-crates publish-npm]
}.freeze
ACTIONS = %w[actions/checkout actions/setup-node actions/download-artifact dtolnay/rust-toolchain rust-lang/crates-io-auth-action].freeze
P17_RUN = "mkdir \"$RUNNER_TEMP/p17\"\nnode scripts/verify-release-set.mjs \"$RUNNER_TEMP/release\" \"$RUNNER_TEMP/p17/p17.json\"\n".freeze
P17_RECORD = {
  'name' => "Record P17's evidence", 'id' => 'record',
  'run' => "REPORT_SHA256=$(node scripts/release-evidence.mjs record \"$RUNNER_TEMP/p17\")\necho \"report-sha256=$REPORT_SHA256\" >> \"$GITHUB_OUTPUT\"\necho \"p17-run-attempt=$GITHUB_RUN_ATTEMPT\" >> \"$GITHUB_OUTPUT\"\n"
}.freeze
P17_VERIFY = 'node scripts/release-evidence.mjs verify "$RUNNER_TEMP/p17" "$RECORD_SHA256"'.freeze
P17_UPLOAD = {
  'uses' => 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9',
  'if' => 'always()',
  'with' => { 'name' => 'release-p17', 'path' => '${{ runner.temp }}/p17/', 'if-no-files-found' => 'error', 'overwrite' => true }
}.freeze

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
  return out + ['J1 exact seven-job release pipeline required'] unless jobs.is_a?(Hash) && jobs.keys.sort == NEEDS.keys.sort
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
    out << "E1 #{name} must fail closed" if job.key?('continue-on-error') || job.key?('container') || job.key?('services') || (name != 'engines' && job.key?('uses'))
    if name == 'engines'
      out << 'B1 all three engines must run from this tagged commit without inputs or secrets' unless job['uses'] == './.github/workflows/e2e-engines.yml' && (job.keys - %w[needs permissions uses]).empty?
    end
    out << "E2 #{name} cannot skip a gate" if job.key?('if') && !PUBLISH.key?(name)
    steps(job).each do |step|
      # Only this exact diagnostic upload may run after failure. The failed verify
      # job still blocks every downstream publisher; its success record is not run.
      evidence_upload = name == 'verify' && step == P17_UPLOAD
      out << "E1 #{name} step must fail closed" if step.key?('continue-on-error') || (step.key?('if') && !evidence_upload)
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
  out << 'K6 support history must be checked before any publishing dependency' unless steps(jobs['check']).any? { |s| s['run'] == 'node scripts/check-release-support.mjs' }
  qualification = steps(jobs['check']).select { |s| s['run'] == 'node scripts/check-release-qualification.mjs' }
  out << 'K9 exact release qualification must run before publishing' unless qualification.length == 1 && qualification.first['env'] == { 'GH_TOKEN' => '${{ github.token }}' }
  %w[check record].each do |name|
    checkout = steps(jobs[name]).select { |s| action(s) == 'actions/checkout' }
    out << "K9 #{name} requires the tagged full history without credentials for the audit binding" unless checkout.length == 1 && checkout.first['with'] == { 'persist-credentials' => false, 'fetch-depth' => 0 }
  end
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
  verify_steps = steps(jobs['verify'])
  # Pin the gate, success-only hash record, and final diagnostic upload together.
  # This must not become a general exception for conditional or ignored gates.
  p17_positions = verify_steps.each_index.select { |i| verify_steps[i]['run'] == P17_RUN }
  uploads = verify_steps.select { |s| action(s) == 'actions/upload-artifact' }
  retention = p17_positions.length == 1 && uploads == [P17_UPLOAD] && verify_steps[-1] == P17_UPLOAD &&
              verify_steps[-2] == P17_RECORD && p17_positions.first == verify_steps.length - 3 &&
              jobs['verify']['outputs'] == { 'report-sha256' => '${{ steps.record.outputs.report-sha256 }}', 'p17-run-attempt' => '${{ steps.record.outputs.p17-run-attempt }}' }
  out << 'K7 exact final P17 upload must retain diagnostics after failure without changing the success proof' unless retention
  record_steps = steps(jobs['record'])
  downloads = record_steps.each_index.select { |i| action(record_steps[i]) == 'actions/download-artifact' && record_steps[i].dig('with', 'name') == 'release-p17' }
  evidence_checks = record_steps.each_index.select { |i| record_steps[i]['run'] == P17_VERIFY }
  writers = record_steps.each_index.select { |i| record_steps[i]['run'] == required['record'] }
  anchored = downloads.length == 1 && evidence_checks.length == 1 && writers.length == 1 &&
             downloads.first < evidence_checks.first && evidence_checks.first < writers.first &&
             record_steps[downloads.first]['with'] == { 'name' => 'release-p17', 'path' => '${{ runner.temp }}/p17', 'digest-mismatch' => 'error' } &&
             record_steps[evidence_checks.first]['env'] == { 'RECORD_SHA256' => '${{ needs.verify.outputs.report-sha256 }}' }
  out << 'K8 record must authenticate the complete nested P17 tree against the verifier output before writing DS12' unless anchored
  out << 'K9 DS12 must retain the verifier manifest identity' unless writers.length == 1 && record_steps[writers.first].dig('env', 'P17_MANIFEST_SHA256') == '${{ needs.verify.outputs.report-sha256 }}'
  out << 'K9 DS12 must retain the verifier attempt on partial reruns' unless writers.length == 1 && record_steps[writers.first].dig('env', 'P17_RUN_ATTEMPT') == '${{ needs.verify.outputs.p17-run-attempt }}'
  out
end

def soak_deferral?(version, milestone, ticket, gate)
  version == '3.0.0' && milestone == 'final' && ticket == 'FORMA-145 soak' &&
    gate.is_a?(Hash) && gate['status'] == 'deferred' &&
    gate['deferral'] == { 'decision' => 'L-66-QUOTA', 'finalVersion' => '3.0.0', 'reference' => 'docs/release/post-release-soak.json' }
end

def contract_violations(contracts)
  out = []
  return ['C0 contract file must be a mapping'] unless contracts.is_a?(Hash)
  out << 'C4 a global publish switch (liveReleaseReady, pending) cannot stand beside the milestones' if contracts.key?('liveReleaseReady') || contracts.key?('pending')
  out << 'C5 the contract must name the one release version its gates are written for (X.Y.Z, 3.0.0 or later)' unless contracts['version'].is_a?(String) && contracts['version'].match?(/\A(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\z/) && contracts['version'].split('.').first.to_i >= 3
  milestones = contracts['milestones']
  return out + ['C1 contract must name exactly alpha, beta, rc and final, in that order'] unless milestones.is_a?(Hash) && milestones.keys == MILESTONES
  seen = {}
  milestones.each do |name, m|
    well_formed = m.is_a?(Hash) && m['plan'].to_s.match?(/\AM\d\z/) && m['gates'].is_a?(Hash) && !m['gates'].empty?
    out << "C2 #{name} needs a plan milestone and non-empty gates" unless well_formed
    next unless m.is_a?(Hash) && m['gates'].is_a?(Hash)
    m['gates'].each do |ticket, gate|
      out << "C2 #{name}: #{ticket} is not a ticket gate" unless ticket.is_a?(String) && ticket.match?(GATE_KEY)
      ordinary = gate.is_a?(Hash) && %w[done pending].include?(gate['status']) && !gate.key?('deferral')
      stated = gate.is_a?(Hash) && (ordinary || soak_deferral?(contracts['version'], name, ticket, gate)) && gate['scope'].is_a?(String) && !gate['scope'].strip.empty?
      out << "C2 #{name}: #{ticket} needs a done/pending status and a scope" unless stated
      out << "C3 #{ticket} gates both #{seen[ticket]} and #{name}" if seen.key?(ticket)
      seen[ticket] = name
    end
  end
  out
end

doc = YAML.safe_load(File.read(WORKFLOW), aliases: false)
doc['on'] = doc.delete(true) if doc.is_a?(Hash) && doc.key?(true)
contracts = JSON.parse(File.read(CONTRACTS))
errors = violations(doc) + contract_violations(contracts)
if ARGV.include?('--self-test') && errors.empty?
  contract_seeds = [
    ['global ready switch', 'C4', ->(c) { c['liveReleaseReady'] = true }],
    ['legacy pending list', 'C4', ->(c) { c['pending'] = {} }],
    ['missing release version', 'C5', ->(c) { c.delete('version') }],
    ['pre-release as the contract version', 'C5', ->(c) { c['version'] = '3.0.0-alpha.1' }],
    ['milestone removed', 'C1', ->(c) { c['milestones'].delete('beta') }],
    ['milestone added', 'C1', ->(c) { c['milestones']['ga'] = c['milestones']['final'] }],
    ['milestones out of order', 'C1', ->(c) { m = c['milestones']; c['milestones'] = { 'final' => m['final'], 'alpha' => m['alpha'], 'beta' => m['beta'], 'rc' => m['rc'] } }],
    ['unknown gate status', 'C2', ->(c) { c['milestones']['beta']['gates'].values.first['status'] = 'skipped' }],
    ['gate without scope', 'C2', ->(c) { c['milestones']['alpha']['gates']['FORMA-110']['scope'] = ' ' }],
    ['gate that is not a ticket', 'C2', ->(c) { c['milestones']['rc']['gates']['founder says so'] = { 'status' => 'done', 'scope' => 'x' } }],
    ['milestone without gates', 'C2', ->(c) { c['milestones']['final']['gates'] = {} }],
    ['milestone without plan', 'C2', ->(c) { c['milestones']['alpha'].delete('plan') }],
    ['gate in two milestones', 'C3', ->(c) { c['milestones']['beta']['gates']['FORMA-110'] = { 'status' => 'done', 'scope' => 'again' } }]
  ]
  contract_seeds.each do |name, rule, mutate|
    seeded = Marshal.load(Marshal.dump(contracts)); mutate.call(seeded)
    errors << "self-test failed to reject contract #{name} with #{rule}" unless contract_violations(seeded).any? { |v| v.start_with?(rule) }
  end
  deferred = Marshal.load(Marshal.dump(contracts))
  deferred['milestones']['final']['gates']['FORMA-145 soak'].merge!('status' => 'deferred', 'deferral' => {
    'decision' => 'L-66-QUOTA', 'finalVersion' => '3.0.0', 'reference' => 'docs/release/post-release-soak.json'
  })
  errors << 'self-test rejected explicit 3.0.0 post-release soak policy' unless contract_violations(deferred).empty?
  deferral_seeds = [
    ['wrong release', ->(c) { c['version'] = '3.0.1' }],
    ['wrong gate', ->(c) { c['milestones']['final']['gates']['FORMA-191'] = c['milestones']['final']['gates'].delete('FORMA-145 soak') }],
    ['wrong milestone', ->(c) { c['milestones']['rc']['gates']['FORMA-145 soak'] = c['milestones']['final']['gates'].delete('FORMA-145 soak') }],
    ['wrong decision', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak']['deferral']['decision'] = 'L-66' }],
    ['wrong reference', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak']['deferral']['reference'] = 'elsewhere.json' }],
    ['wrong final version', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak']['deferral']['finalVersion'] = '3.0.1' }],
    ['missing descriptor', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak'].delete('deferral') }],
    ['empty scope', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak']['scope'] = ' ' }],
    ['done with deferral', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak']['status'] = 'done' }],
    ['pending with deferral', ->(c) { c['milestones']['final']['gates']['FORMA-145 soak']['status'] = 'pending' }]
  ]
  deferral_seeds.each do |name, mutate|
    seeded = Marshal.load(Marshal.dump(deferred)); mutate.call(seeded)
    errors << "self-test failed to reject soak deferral #{name}" if contract_violations(seeded).empty?
  end
  seeds = [
    ['branch trigger', 'T1', ->(d) { d['on']['push']['branches'] = ['main'] }],
    ['dispatch trigger', 'T1', ->(d) { d['on']['workflow_dispatch'] = nil }],
    ['cancelling release', 'T2', ->(d) { d['concurrency']['cancel-in-progress'] = true }],
    ['new ungated job', 'J1', ->(d) { d['jobs']['other'] = {} }],
    ['OIDC on pack', 'P2', ->(d) { d['jobs']['pack']['permissions']['id-token'] = 'write' }],
    ['global OIDC', 'P1', ->(d) { d['permissions'] = 'write-all' }],
    ['P17 drops packed-set dependency', 'J2', ->(d) { d['jobs']['verify']['needs'].delete('pack') }],
    ['missing engine job', 'J1', ->(d) { d['jobs'].delete('engines') }],
    ['skipped engine suite', 'E2', ->(d) { d['jobs']['engines']['if'] = 'false' }],
    ['replaced engine suite', 'B1', ->(d) { d['jobs']['engines']['uses'] = './.github/workflows/ci.yml' }],
    ['credential passed to engines', 'B1', ->(d) { d['jobs']['engines']['secrets'] = 'inherit' }],
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
    ['missing support history check', 'K6', ->(d) { d['jobs']['check']['steps'].reject! { |s| s['run'] == 'node scripts/check-release-support.mjs' } }],
    ['no release record', 'K1', ->(d) { d['jobs']['record']['steps'].reject! { |s| s['run'] } }]
  ]
  %w[publish-crates publish-npm record].each do |name|
    %w[engines verify].each do |prerequisite|
      seeds << ["#{name} drops #{prerequisite} dependency", 'J2', ->(d) { d['jobs'][name]['needs'].delete(prerequisite) }]
    end
  end
  ['if false; then CHECK; fi', 'exit 0\nCHECK', 'f() { CHECK; }', 'CHECK || true', '"set" +e\nCHECK'].each do |wrapper|
    seeds << ["hidden check: #{wrapper}", 'E4', lambda { |d| d['jobs']['publish-npm']['steps'].find { |s| s['run'] == VERIFY }['run'] = wrapper.gsub('CHECK', VERIFY).gsub('\\n', "\n") }]
  end
  seeds << ['artifact from another run', 'A1', lambda { |d| d['jobs']['publish-npm']['steps'].find { |s| action(s) == 'actions/download-artifact' }['with']['run-id'] = '123' }]
  seeds << ['replaced hash anchor', 'A2', lambda { |d| d['jobs']['publish-npm']['steps'].find { |s| s['run'] == VERIFY }['env']['RECORD_SHA256'] = 'artifact supplied hash' }]
  seeds.each do |name, rule, mutate|
    seeded = Marshal.load(Marshal.dump(doc)); mutate.call(seeded)
    errors << "self-test failed to reject #{name} with #{rule}" unless violations(seeded).any? { |v| v.start_with?(rule) }
  end
  puts "#{seeds.length} SR13/SR43 workflow and #{contract_seeds.length} milestone-contract seeded violations rejected" if errors.empty?
  puts "explicit post-release soak accepted; #{deferral_seeds.length} invalid deferrals rejected" if errors.empty?
  errors << 'release helper tests failed' unless system('node', '--test', *Dir.glob('scripts/release*.test.mjs').sort)
end
abort(errors.join("\n")) unless errors.empty?
ready = MILESTONES.select do |name|
  MILESTONES[0..MILESTONES.index(name)].all? { |m| contracts['milestones'][m]['gates'].all? { |ticket, g| g['status'] == 'done' || (name == 'final' && soak_deferral?(contracts['version'], m, ticket, g)) } }
end
puts "release workflow: tag → exact CI → (locked pack → P17) alongside three engines → crates → npm → record; both verification gates required before publication; credential jobs constrained; milestones ready to publish: #{ready.empty? ? 'none' : ready.join(', ')}"
puts 'FORMA-145 soak: deferred after final 3.0.0 under L-66-QUOTA; zero active credit, not passed' if contracts.dig('milestones', 'final', 'gates', 'FORMA-145 soak', 'status') == 'deferred'
