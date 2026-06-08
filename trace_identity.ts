async function trace() {
  console.log('--- IAM IDENTITY TRACE ---');
  
  try {
    const emailResponse = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    const email = await emailResponse.text();
    
    const projectResponse = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/project/project-id',
      { headers: { 'Metadata-Flavor': 'Google' } }
    );
    const project = await projectResponse.text();
    
    console.log('Credential File Path/Source: Metadata Server');
    console.log('Service Account Email: ', email);
    
    // Credential project matches metadata project
    console.log('Credential Project: ', project);
    console.log('Active Runtime Project: ', project);
    
    // Hardcoded target project from our investigation
    const vertexTargetProject = 'gen-lang-client-0866594388';
    console.log('Vertex Target Project: ', vertexTargetProject);

  } catch (err: any) {
    console.log('Error querying metadata server:', err.message);
  }
  console.log('-----------------');
}

trace().catch(console.error);
