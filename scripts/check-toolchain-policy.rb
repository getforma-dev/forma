#!/usr/bin/env ruby
# Parse the actual workflow so a manifest claim cannot outlive its executed job.
require 'yaml'
require 'json'
require 'open3'
root = ARGV[0] || File.expand_path('..', __dir__)
ci = YAML.load_file(File.join(root, '.github/workflows/ci.yml'))
jobs = ci.fetch('jobs')
failures = []
out, status = Open3.capture2('node', File.join(root, 'scripts/toolchain-matrix.mjs'))
abort 'toolchain matrix producer failed' unless status.success?
lines = JSON.parse(out)
# Maintenance qualifies the private workspace with its declared build pin.
# Published-package compatibility deliberately keeps the separate dated matrix.
pin_path = File.join(root, '.node-version')
abort 'missing maintenance Node pin' unless File.file?(pin_path)
pin = File.read(pin_path).strip
abort 'maintenance Node pin must be a complete release version' unless pin.match?(/\A(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\z/)
major = pin.split('.').first.to_i
failures << 'maintenance Node major is outside the supported matrix' unless lines.include?(major)
private_pkg = JSON.parse(File.read(File.join(root, 'package.json')))
failures << 'private workspace Node range must agree with the maintenance pin' unless private_pkg.dig('engines', 'node') == ">=#{pin} <#{major + 1}"
maintenance = {
  'ci.yml' => %w[check toolchains],
  'e2e-engines.yml' => %w[e2e parity],
  'nightly-probes.yml' => %w[expressions probes],
  'value-rules.yml' => %w[qualify],
  'release-plane-observe.yml' => %w[observe]
}
maintenance.each do |file, names|
  workflow = YAML.load_file(File.join(root, '.github/workflows', file))
  names.each do |name|
    job = workflow.fetch('jobs', {}).fetch(name, {})
    setup = Array(job['steps']).select { |s| s['uses'].to_s.start_with?('actions/setup-node@') }
    step = setup.first || {}
    options = step.fetch('with', {})
    unless setup.length == 1 && options['node-version-file'] == '.node-version' && !options.key?('node-version') &&
        !job.key?('if') && !job.key?('continue-on-error') && !step.key?('if') && !step.key?('continue-on-error')
      failures << "#{file}/#{name}: maintenance must unconditionally use only the declared Node pin"
    end
  end
end
# These existing literal pins already match; keep them checked without changing
# their setup behavior in this repair.
{ 'ci.yml' => 'deny', 'advisories.yml' => 'audit' }.each do |file, name|
  workflow = YAML.load_file(File.join(root, '.github/workflows', file))
  setup = Array(workflow.fetch('jobs', {}).fetch(name, {})['steps']).select { |s| s['uses'].to_s.start_with?('actions/setup-node@') }
  options = (setup.first || {}).fetch('with', {})
  failures << "#{file}/#{name}: literal maintenance Node differs from the pin" unless setup.length == 1 && options['node-version'] == pin && !options.key?('node-version-file')
end
%w[core compiler build create-app].each do |name|
  pkg = JSON.parse(File.read(File.join(root, "packages/#{name}/package.json")))
  failures << "#{name}: engines.node must equal the tested floor" unless pkg.dig('engines', 'node') == ">=#{lines.min}"
end
producer = jobs.fetch('toolchains', {})
producer_step = (producer['steps'] || []).find { |s| s['id'] == 'matrix' }
failures << 'matrix producer must run unconditionally' if producer['if'] || producer_step&.key?('if') || producer['continue-on-error'] || producer_step&.key?('continue-on-error')
failures << 'matrix output is disconnected' unless producer.dig('outputs', 'node-versions') == '${{ steps.matrix.outputs.node_versions }}' && producer_step && producer_step['run'] == 'node scripts/toolchain-matrix.mjs --github-output'
node = jobs.fetch('node', {})
failures << 'Node job must consume the policy matrix unconditionally' unless Array(node['needs']).include?('toolchains') && node.dig('strategy', 'matrix', 'node-version') == '${{ fromJSON(needs.toolchains.outputs.node-versions) }}' && !node.key?('if') && !node.key?('continue-on-error')
steps = node['steps'] || []
failures << 'Node setup does not use the matrix version' unless steps.any? { |s| s['uses'].to_s.start_with?('actions/setup-node@') && s.dig('with', 'node-version') == '${{ matrix.node-version }}' && !s.key?('if') }
%w[build test].each do |command|
  expected = command == 'build' ? 'npm run build' : 'npm test --workspaces'
  failures << "Node job does not execute #{command}" unless steps.any? { |s| s['run'] == expected && !s.key?('if') && !s.key?('continue-on-error') }
end
msrv = jobs.fetch('msrv', {})
actual = msrv.dig('strategy', 'matrix', 'include')
expected = %w[forma-ir forma-ir-derive forma-server].map do |name|
  manifest = File.read(File.join(root, "crates/#{name}/Cargo.toml"))
  version = manifest.match(/^rust-version\s*=\s*"([^"]+)"/)&.captures&.first
  abort "#{name}: missing declared rust-version" unless version
  { 'crate' => name, 'rust' => version }
end
failures << 'MSRV matrix differs from declared crate floors' unless actual == expected
failures << 'MSRV job must be blocking and unconditional' if msrv.key?('if') || msrv.key?('continue-on-error')
msrv_steps = msrv['steps'] || []
failures << 'MSRV setup does not install the declared floor' unless msrv_steps.any? { |s| s.dig('with', 'toolchain') == '${{ matrix.rust }}' && !s.key?('if') }
['cargo check -p ${{ matrix.crate }} --all-targets --locked', 'bash scripts/check-msrv-fresh.sh "${{ matrix.crate }}" "${{ matrix.rust }}"'].each do |command|
  failures << "missing mandatory MSRV check: #{command}" unless msrv_steps.any? { |s| s['run'] == command && !s.key?('if') && !s.key?('continue-on-error') }
end
abort failures.join("\n") unless failures.empty?
puts "Toolchain policy: maintenance Node #{pin}, private range, four published floors, dated matrix, and three locked/fresh MSRV checks agree."
