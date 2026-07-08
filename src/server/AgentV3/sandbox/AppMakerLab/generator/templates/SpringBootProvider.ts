import { ITemplateProvider } from './ViteReactProvider';

// Spring Boot (Java 17) backend scaffold — runs on the fullstack E2B template (JDK 17 + Maven).
// A minimal but REAL, runnable app: `mvn spring-boot:run` starts a web server bound to 0.0.0.0:$PORT
// (so the E2B preview proxy can reach it) with a REST controller. Kept intentionally small — the agent
// builds the requested app on top of this baseline.

const POM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.2</version>
    <relativePath/>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <name>demo</name>
  <properties>
    <java.version>17</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;

const APPLICATION_JAVA = `package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`;

const HELLO_CONTROLLER_JAVA = `package com.example.demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {
    @GetMapping("/")
    public String hello() {
        return "Hello from Spring Boot!";
    }
}
`;

// Single-quoted (NOT a template literal): the `${PORT:8080}` must reach the file LITERALLY — Spring
// resolves it at runtime (PORT env, default 8080). server.address=0.0.0.0 lets the E2B preview reach it.
const APPLICATION_PROPERTIES =
  'server.port=${PORT:8080}\n' +
  'server.address=0.0.0.0\n';

export class SpringBootProvider implements ITemplateProvider {
  getFiles(_features: string[]): Record<string, string> {
    return {
      'pom.xml': POM_XML,
      'src/main/java/com/example/demo/Application.java': APPLICATION_JAVA,
      'src/main/java/com/example/demo/HelloController.java': HELLO_CONTROLLER_JAVA,
      'src/main/resources/application.properties': APPLICATION_PROPERTIES,
    };
  }
}
